import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { ACTIVE_BOOKING, STAY_BOOKED, stayHasActiveBooking, syncQuoteBooked } from "@/server/quotes/quote-booking";
import { db } from "@/server/db";
import { formatMinor } from "@/lib/supplier-money";
import { findOffer } from "@/server/search/search";
import { clientDateAllowed, dayAhead, defaultClientDate, lastFreeDay, offerOver, parseMarkup, sellingMinor, todayIso } from "@/server/quotes/pricing";

// Quotes (screens 14, 15; plan 5b). Every function takes the agencyId from the caller's session
// (requireAgent), never from the request. A quote, destination, hotel or room of another agency is
// never found or changed: child rows are always looked up through their quote's agencyId (no
// IDOR). The audit log records ids and what kind of change happened, never a client's details.

export const QUOTE_PAGE_SIZE = 20;
export const MAX_STAYS = 10;
export const MAX_HOTELS_PER_STAY = 20;
export const MAX_ROOMS_PER_HOTEL = 10;
// Plan 10: a quote is for one room; a search of several rooms says this instead of "Add to quote"
// (several-room quotes are plan 10b), and the server refuses with it.
export const QUOTES_ONE_ROOM = "Quotes are for one room for now.";

export const QUOTE_TABS = ["all", "draft", "sent", "viewed", "selected", "booked"] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];
const TAB_STATUS = { draft: "DRAFT", sent: "SENT", viewed: "VIEWED", selected: "SELECTED", booked: "BOOKED" } as const;

// `confirm`: the change was not made because it needs the agent's explicit yes first (the form
// then shows a tick box and the same save goes through with it).
export type Result = { ok: true; id: string; clientChanged?: true } | { ok: false; error: string; confirm?: "clientChange" | "belowNet" };

const fail = (error: string): Result => ({ ok: false, error });

const NOT_FOUND = "This quote was not found.";

// "Q-7": the agency's own running number. Every `number` this file returns is that number (the
// internal one, shared by all agencies, only on a row that has none yet), so a client never sees
// how many quotes other agencies made.
export function quoteCode(number: number): string {
  return `Q-${number}`;
}

function shownNumber(row: { number: number; agencyNumber: number | null }): number {
  return row.agencyNumber ?? row.number;
}

// The next running number of the agency, with the agency's row locked for the rest of the
// transaction: two quotes made at the same moment get two numbers.
async function nextAgencyNumber(tx: Prisma.TransactionClient, agencyId: string): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
  const last = await tx.quote.aggregate({ where: { agencyId }, _max: { agencyNumber: true } });
  return (last._max.agencyNumber ?? 0) + 1;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- create and read ----------

export async function createQuote(
  actorUserId: string,
  agencyId: string,
  options: { clientId?: string | undefined } = {},
): Promise<Result> {
  const clientId = options.clientId ? await ownClientId(agencyId, options.clientId) : null;
  if (options.clientId && !clientId) return fail("This client was not found.");
  const id = await db.$transaction(async (tx) => {
    const agency = await tx.agency.findUniqueOrThrow({ where: { id: agencyId }, select: { id: true } });
    const quote = await tx.quote.create({
      data: { agencyId: agency.id, agencyNumber: await nextAgencyNumber(tx, agency.id), createdById: actorUserId, clientId, ...(await newQuoteDefaults(tx, agencyId)) },
      select: { id: true },
    });
    await audit(actorUserId, "quote.create", "Quote", quote.id, undefined, undefined, tx);
    return quote.id;
  });
  return { ok: true, id };
}

// A new quote starts with the agency's defaults (screen 20: language, message, markup, cancellation).
async function newQuoteDefaults(tx: Prisma.TransactionClient, agencyId: string) {
  const a = await tx.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { defaultQuoteLanguage: true, defaultQuoteMessage: true, defaultMarkupType: true, defaultMarkupValue: true, defaultShowCancellation: true },
  });
  return {
    language: a.defaultQuoteLanguage,
    message: a.defaultQuoteMessage,
    markupType: a.defaultMarkupType,
    markupValue: a.defaultMarkupValue,
    showCancellation: a.defaultShowCancellation,
  };
}

async function ownClientId(agencyId: string, clientId: string): Promise<string | null> {
  if (typeof clientId !== "string" || clientId.length > 64) return null;
  return (await db.client.findFirst({ where: { id: clientId, agencyId }, select: { id: true } }))?.id ?? null;
}

export type QuoteListItem = {
  id: string;
  number: number;
  title: string;
  status: "DRAFT" | "SENT" | "VIEWED" | "SELECTED" | "BOOKED";
  client: { firstName: string; lastName: string; email: string | null } | null;
  destinations: string[];
  stays: number;
  hotels: number;
  rooms: number;
  firstCheckin: string | null;
  lastCheckout: string | null;
  adults: number;
  childAges: number[];
  sentAt: Date | null;
  viewedAt: Date | null;
  selectedAt: Date | null;
  editedAt: Date; // the agent's last edit ("Last updated"); a client's view or choice does not move it
  // The offer ran out (its last day passed, or every check-in did) on a quote the client could
  // still answer; "Extend offer" on the quote opens it again.
  expired: boolean;
  closed: boolean; // the agent closed it ("Close quote")
  // The latest confirmed booking made from the quote (plan 5d).
  booking: { id: string; reference: string; hotelName: string; confirmedAt: Date | null } | null;
};

// A shared quote the client can no longer answer: the offer's last day passed, or the check-in of
// every destination did. Never for a draft (not shared yet), a booked or a closed quote.
export function quoteExpired(
  quote: { status: QuoteListItem["status"]; validUntil: Date | null; closedAt: Date | null; stays: { checkin: string }[] },
  now: Date,
): boolean {
  if (quote.status === "DRAFT" || quote.status === "BOOKED" || quote.closedAt) return false;
  if (offerOver(quote.validUntil, now)) return true;
  const today = todayIso(now);
  return quote.stays.length > 0 && quote.stays.every((s) => !dayAhead(s.checkin, today));
}

export type QuotePage = { quotes: QuoteListItem[]; nextCursor: string | null };

// The agent's newest edit first, 20 per page. The cursor must be one of the agency's own quotes.
export async function listQuotes(
  agencyId: string,
  options: { tab?: QuoteTab | undefined; q?: string | undefined; cursor?: string | undefined; clientId?: string | undefined },
  now: Date = new Date(),
): Promise<QuotePage> {
  const where: Prisma.QuoteWhereInput = { agencyId };
  const tab = options.tab ?? "all";
  if (tab !== "all") where.status = TAB_STATUS[tab];
  if (options.clientId) where.clientId = options.clientId;
  const q = (options.q ?? "").trim().slice(0, 100);
  if (q) {
    const number = /^(?:q-?)?(\d{1,9})$/i.exec(q);
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { stays: { some: { destinationName: { contains: q, mode: "insensitive" } } } },
      { client: { firstName: { contains: q, mode: "insensitive" } } },
      { client: { lastName: { contains: q, mode: "insensitive" } } },
      // "Q-7" is the agency's own number (the internal one only on a row that has none yet).
      ...(number ? [{ agencyNumber: Number(number[1]) }, { agencyNumber: null, number: Number(number[1]) }] : []),
    ];
  }
  const cursor = options.cursor
    ? ((await db.quote.findFirst({ where: { id: options.cursor, agencyId }, select: { id: true } }))?.id ?? null)
    : null;
  const rows = await db.quote.findMany({
    where,
    orderBy: [{ editedAt: "desc" }, { id: "desc" }],
    take: QUOTE_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      agencyNumber: true,
      title: true,
      status: true,
      adults: true,
      childAges: true,
      sentAt: true,
      viewedAt: true,
      selectedAt: true,
      editedAt: true,
      validUntil: true,
      closedAt: true,
      client: { select: { firstName: true, lastName: true, email: true } },
      stays: {
        orderBy: { position: "asc" },
        select: { destinationName: true, checkin: true, checkout: true, hotels: { select: { _count: { select: { rooms: true } } } } },
      },
      bookings: {
        where: { agencyId, status: "CONFIRMED" },
        orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, reference: true, hotelName: true, confirmedAt: true },
      },
    },
  });
  const page = rows.slice(0, QUOTE_PAGE_SIZE);
  return {
    quotes: page.map((row) => {
      const checkins = row.stays.map((s) => s.checkin).sort();
      const checkouts = row.stays.map((s) => s.checkout).sort();
      return {
        id: row.id,
        number: shownNumber(row),
        title: row.title,
        status: row.status,
        client: row.client,
        destinations: [...new Set(row.stays.map((s) => s.destinationName))],
        stays: row.stays.length,
        hotels: row.stays.reduce((n, s) => n + s.hotels.length, 0),
        rooms: row.stays.reduce((n, s) => n + s.hotels.reduce((m, h) => m + h._count.rooms, 0), 0),
        firstCheckin: checkins[0] ?? null,
        lastCheckout: checkouts.at(-1) ?? null,
        adults: row.adults,
        childAges: row.childAges,
        sentAt: row.sentAt,
        viewedAt: row.viewedAt,
        selectedAt: row.selectedAt,
        editedAt: row.editedAt,
        expired: quoteExpired(row, now),
        closed: row.closedAt !== null,
        booking: row.bookings[0] ?? null,
      };
    }),
    nextCursor: rows.length > QUOTE_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

const quoteDetailSelect = {
  id: true,
  number: true,
  agencyNumber: true,
  title: true,
  status: true,
  language: true,
  message: true,
  showCancellation: true,
  markupType: true,
  markupValue: true,
  adults: true,
  childAges: true,
  shareToken: true,
  sentAt: true,
  viewedAt: true,
  viewCount: true,
  selectedAt: true,
  clientNote: true,
  validUntil: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  editedAt: true,
  client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  agency: { select: { country: true } }, // for the client's phone: a local number gets this country's code
  stays: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      destinationId: true,
      destinationName: true,
      checkin: true,
      checkout: true,
      selectedRoomId: true,
      selectedSellMinor: true,
      selectedCurrency: true,
      hotels: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          propertyId: true,
          name: true,
          city: true,
          starRating: true,
          agencyPick: true,
          rooms: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              roomName: true,
              bedDescription: true,
              amenities: true,
              refundable: true,
              freeCancelUntil: true,
              clientCancelUntil: true,
              netMinor: true,
              currency: true,
              price: true,
              sellMinor: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.QuoteSelect;

export type QuoteDetail = Prisma.QuoteGetPayload<{ select: typeof quoteDetailSelect }>;

export async function getQuote(agencyId: string, quoteId: string): Promise<QuoteDetail | null> {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  const quote = await db.quote.findFirst({ where: { id: quoteId, agencyId }, select: quoteDetailSelect });
  return quote && { ...quote, number: shownNumber(quote) };
}

// The agency's quotes that can still take rooms (not booked, not closed), newest first, for "Add
// to quote". `include`: one more quote that must be in the list even if it is older (the quote
// the agent came from, "+ Add hotel"), if it is the agency's own and can still take rooms.
export async function openQuotes(agencyId: string, include?: string | null): Promise<{ id: string; number: number; title: string }[]> {
  const select = { id: true, number: true, agencyNumber: true, title: true } as const;
  const open = { agencyId, status: { not: "BOOKED" }, closedAt: null } as const;
  const shown = (q: { id: string; number: number; agencyNumber: number | null; title: string }) => ({ id: q.id, number: shownNumber(q), title: q.title });
  const latest = await db.quote.findMany({
    where: open,
    orderBy: [{ editedAt: "desc" }, { id: "desc" }],
    take: 30,
    select,
  });
  if (!include || latest.some((q) => q.id === include)) return latest.map(shown);
  const extra = await db.quote.findFirst({ where: { ...open, id: include }, select });
  return (extra ? [extra, ...latest] : latest).map(shown);
}

// ---------- settings ----------

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));

export const quoteSettingsInput = z
  .object({
    title: plainText(80),
    clientId: z.string().max(64),
    language: z.enum(["EN", "HE"]),
    message: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(z.string().trim().max(1000).refine((value) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(value))),
    showCancellation: z.boolean(),
    markupType: z.string(),
    markupValue: z.string().max(20),
    adults: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(1).max(8)),
    childAges: z
      .string()
      .max(40)
      .transform((value) => value.split(",").map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(0).max(17))).max(6)),
    // The agent's yes to what another client on the quote removes (see CLIENT_CHANGE).
    confirmClientChange: z.boolean().optional(),
  })
  .strict();

export type QuoteSettingsInput = z.input<typeof quoteSettingsInput>;

// Shown before another client is saved on a quote that already has one, and saved only with the
// agent's tick: the change cannot be undone.
export const CLIENT_CHANGE =
  "Changing the client stops the client link that was sent, and removes the selections and the note the client sent. Tick the box and save again to change the client.";
export const CLIENT_CHANGED = "Changes saved. The old client link no longer works, and the selections and note of the previous client were removed. Send the quote to the new client.";

const SETTINGS_ERROR =
  "Check the form: a title up to 80 characters, a message up to 1,000, a markup from 0 to 100% or up to USD 10,000 per room, 1 to 8 adults and up to 6 children aged 0 to 17.";

export async function updateQuoteSettings(
  actorUserId: string,
  agencyId: string,
  quoteId: string,
  rawInput: QuoteSettingsInput,
): Promise<Result> {
  const parsed = quoteSettingsInput.safeParse(rawInput);
  if (!parsed.success) return fail(SETTINGS_ERROR);
  const input = parsed.data;
  const markup = parseMarkup(input.markupType, input.markupValue);
  if (!markup) return fail(SETTINGS_ERROR);
  const clientId = input.clientId ? await ownClientId(agencyId, input.clientId) : null;
  if (input.clientId && !clientId) return fail("This client was not found.");

  return db.$transaction(async (tx) => {
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    const guestsChanged = quote.adults !== input.adults || quote.childAges.join(",") !== input.childAges.join(",");
    if (guestsChanged && (await roomCount(tx, quoteId)) > 0) {
      return fail("The guests cannot change once the quote has rooms: the prices are for these guests. Remove the rooms first.");
    }
    // A new client must never open the old client's link or see their picks and note: the link
    // is withdrawn and the quote goes back to a draft, to be sent again.
    // Adding the first client keeps the link (it may already be with that client).
    const clientChanged = quote.clientId !== null && quote.clientId !== clientId;
    // A booked destination is the old client's booking: the client cannot change under it.
    if (clientChanged && (await tx.booking.count({ where: { quoteId, agencyId, status: { in: ACTIVE_BOOKING } } })) > 0) {
      return fail("This quote has a booking. Cancel the booking first to change the client.");
    }
    // Nothing is removed without the agent's explicit yes: the form lists what goes and asks.
    if (clientChanged && input.confirmClientChange !== true) return { ok: false, error: CLIENT_CHANGE, confirm: "clientChange" } as const;
    if (clientChanged) {
      await tx.quoteStay.updateMany({ where: { quoteId }, data: { selectedRoomId: null, selectedSellMinor: null, selectedCurrency: null } });
    }
    await tx.quote.update({
      where: { id: quoteId },
      data: {
        ...(clientChanged ? { status: "DRAFT", shareToken: null, clientNote: "", sentAt: null, viewedAt: null, viewCount: 0, selectedAt: null, validUntil: null } : {}),
        editedAt: new Date(),
        title: input.title,
        clientId,
        language: input.language,
        message: input.message,
        showCancellation: input.showCancellation,
        ...markup,
        adults: input.adults,
        childAges: input.childAges,
      },
    });
    await audit(actorUserId, "quote.settings", "Quote", quoteId, undefined, clientChanged ? { clientChanged: true } : undefined, tx);
    return { ok: true, id: quoteId, ...(clientChanged ? { clientChanged: true as const } : {}) };
  });
}

// Locks the quote row for the rest of the transaction, and proves it belongs to the agency.
async function lockQuote(tx: Prisma.TransactionClient, agencyId: string, quoteId: string) {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Quote" WHERE id = ${quoteId} AND "agencyId" = ${agencyId} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { id: true, status: true, adults: true, childAges: true, clientId: true, closedAt: true } });
}

const BOOKED = "This quote is booked and can no longer change.";
const CLOSED = "This quote is closed. Choose Reopen quote to change it.";

// Locks the quote for an edit. null: not the agency's quote; "booked" or "closed": it can no
// longer change (a closed quote can be reopened).
async function lockForEdit(tx: Prisma.TransactionClient, agencyId: string, quoteId: string) {
  const quote = await lockQuote(tx, agencyId, quoteId);
  if (!quote) return null;
  if (quote.status === "BOOKED") return "booked" as const;
  return quote.closedAt ? ("closed" as const) : quote;
}

// "Close quote": the agent is done with it (the trip is booked in part, or the client went
// quiet). The client page turns read-only with a neutral message and nothing on the quote
// changes until "Reopen quote". Bookings made from it are not touched.
export async function closeQuote(actorUserId: string, agencyId: string, quoteId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const quote = await lockQuote(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote.status === "BOOKED") return fail("This quote is booked: there is nothing left to close.");
    if (quote.closedAt) return { ok: true, id: quoteId } as const;
    await tx.quote.update({ where: { id: quoteId }, data: { closedAt: new Date(), editedAt: new Date() } });
    await audit(actorUserId, "quote.close", "Quote", quoteId, undefined, undefined, tx);
    return { ok: true, id: quoteId } as const;
  });
}

export async function reopenQuote(actorUserId: string, agencyId: string, quoteId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const quote = await lockQuote(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (!quote.closedAt) return { ok: true, id: quoteId } as const;
    await tx.quote.update({ where: { id: quoteId }, data: { closedAt: null, editedAt: new Date() } });
    await audit(actorUserId, "quote.reopen", "Quote", quoteId, undefined, undefined, tx);
    return { ok: true, id: quoteId } as const;
  });
}

async function roomCount(tx: Prisma.TransactionClient, quoteId: string): Promise<number> {
  return tx.quoteRoom.count({ where: { hotel: { stay: { quoteId } } } });
}

// The agent changed the quote: it moves to the top of the list ("Last updated").
async function touch(tx: Prisma.TransactionClient, quoteId: string): Promise<void> {
  await tx.quote.update({ where: { id: quoteId }, data: { editedAt: new Date() } });
}

// After a room, hotel or destination is removed: a pick on a removed room is gone (the database
// clears the room id), so its stored price goes too, and a quote with no pick left is no longer
// "Selected".
async function afterRemoval(tx: Prisma.TransactionClient, quoteId: string, actorUserId: string): Promise<void> {
  await tx.quoteStay.updateMany({ where: { quoteId, selectedRoomId: null }, data: { selectedSellMinor: null, selectedCurrency: null } });
  const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, viewedAt: true, agencyId: true } });
  if (quote.status !== "SELECTED") return;
  const picks = await tx.quoteStay.count({ where: { quoteId, selectedRoomId: { not: null } } });
  if (picks === 0) await tx.quote.update({ where: { id: quoteId }, data: { status: quote.viewedAt ? "VIEWED" : "SENT" } });
  // The destinations that still have rooms may all be booked already: the quote is then booked.
  else await syncQuoteBooked(tx, quoteId, quote.agencyId, actorUserId);
}

// ---------- destinations ----------

const stayInput = z
  .object({
    destinationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    checkin: z.string().regex(ISO_DAY),
    checkout: z.string().regex(ISO_DAY),
  })
  .strict();

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

function validStayDates(checkin: string, checkout: string, now: Date): boolean {
  const ci = new Date(`${checkin}T00:00:00Z`);
  const co = new Date(`${checkout}T00:00:00Z`);
  if (ci.toISOString().slice(0, 10) !== checkin || co.toISOString().slice(0, 10) !== checkout) return false;
  const nights = nightsBetween(checkin, checkout);
  const today = todayIso(now);
  return checkin >= today && nightsBetween(today, checkin) <= 365 && nights >= 1 && nights <= 28;
}

export async function addStay(
  actorUserId: string,
  agencyId: string,
  quoteId: string,
  rawInput: { destinationId: string; checkin: string; checkout: string },
  now: Date = new Date(),
): Promise<Result> {
  const parsed = stayInput.safeParse(rawInput);
  if (!parsed.success || !validStayDates(parsed.data.checkin, parsed.data.checkout, now)) {
    return fail("Choose a destination from the list, and dates from today up to a year ahead, 1 to 28 nights.");
  }
  const destination = await db.destination.findFirst({ where: { id: parsed.data.destinationId, active: true }, select: { id: true, nameFull: true } });
  if (!destination) return fail("Choose a destination from the list.");
  return db.$transaction(async (tx) => {
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    const stay = await createStay(tx, quoteId, destination, parsed.data.checkin, parsed.data.checkout);
    if (!stay) return fail(`A quote can have up to ${MAX_STAYS} destinations.`);
    await audit(actorUserId, "quote.stay.add", "Quote", quoteId, undefined, { stayId: stay }, tx);
    return { ok: true, id: stay } as const;
  });
}

async function createStay(
  tx: Prisma.TransactionClient,
  quoteId: string,
  destination: { id: string; nameFull: string },
  checkin: string,
  checkout: string,
): Promise<string | null> {
  const count = await tx.quoteStay.count({ where: { quoteId } });
  if (count >= MAX_STAYS) return null;
  const last = await tx.quoteStay.findFirst({ where: { quoteId }, orderBy: { position: "desc" }, select: { position: true } });
  const stay = await tx.quoteStay.create({
    data: { quoteId, destinationId: destination.id, destinationName: destination.nameFull, checkin, checkout, position: (last?.position ?? -1) + 1 },
    select: { id: true },
  });
  await touch(tx, quoteId);
  return stay.id;
}

export async function removeStay(actorUserId: string, agencyId: string, stayId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const stay = await tx.quoteStay.findFirst({ where: { id: stayId, quote: { agencyId } }, select: { id: true, quoteId: true } });
    if (!stay) return fail(NOT_FOUND);
    const quote = await lockForEdit(tx, agencyId, stay.quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    if (await stayHasActiveBooking(tx, stay.id)) return fail(STAY_BOOKED);
    await tx.quoteStay.delete({ where: { id: stay.id } });
    await afterRemoval(tx, stay.quoteId, actorUserId);
    await touch(tx, stay.quoteId);
    await audit(actorUserId, "quote.stay.remove", "Quote", stay.quoteId, { stayId: stay.id }, undefined, tx);
    return { ok: true, id: stay.quoteId } as const;
  });
}

// ---------- hotels ----------

// Finds the agency's hotel, locks its quote, then reads the hotel again: positions and the pick
// are always read after the lock, so two quick clicks are applied one after the other.
async function lockedHotel(tx: Prisma.TransactionClient, agencyId: string, hotelId: string): Promise<Result | Awaited<ReturnType<typeof readHotel>>> {
  if (typeof hotelId !== "string" || hotelId.length > 64) return fail(NOT_FOUND);
  const found = await tx.quoteHotel.findFirst({ where: { id: hotelId, stay: { quote: { agencyId } } }, select: { stay: { select: { quoteId: true } } } });
  if (!found) return fail(NOT_FOUND);
  const quote = await lockForEdit(tx, agencyId, found.stay.quoteId);
  if (!quote) return fail(NOT_FOUND);
  if (quote === "booked") return fail(BOOKED);
  if (quote === "closed") return fail(CLOSED);
  return readHotel(tx, hotelId);
}

function readHotel(tx: Prisma.TransactionClient, hotelId: string) {
  return tx.quoteHotel.findUniqueOrThrow({
    where: { id: hotelId },
    select: { id: true, stayId: true, position: true, agencyPick: true, stay: { select: { quoteId: true } } },
  });
}

function isResult(value: unknown): value is Result {
  return typeof value === "object" && value !== null && "ok" in value;
}

export async function moveHotel(actorUserId: string, agencyId: string, hotelId: string, direction: "up" | "down"): Promise<Result> {
  return db.$transaction(async (tx) => {
    const hotel = await lockedHotel(tx, agencyId, hotelId);
    if (isResult(hotel)) return hotel;
    const neighbour = await tx.quoteHotel.findFirst({
      where: { stayId: hotel.stayId, position: direction === "up" ? { lt: hotel.position } : { gt: hotel.position } },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
      select: { id: true, position: true },
    });
    if (neighbour) {
      await tx.quoteHotel.update({ where: { id: hotel.id }, data: { position: neighbour.position } });
      await tx.quoteHotel.update({ where: { id: neighbour.id }, data: { position: hotel.position } });
      await touch(tx, hotel.stay.quoteId);
    }
    return { ok: true, id: hotel.stay.quoteId } as const;
  });
}

export async function toggleAgencyPick(actorUserId: string, agencyId: string, hotelId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const hotel = await lockedHotel(tx, agencyId, hotelId);
    if (isResult(hotel)) return hotel;
    await tx.quoteHotel.update({ where: { id: hotel.id }, data: { agencyPick: !hotel.agencyPick } });
    await touch(tx, hotel.stay.quoteId);
    await audit(actorUserId, "quote.hotel.pick", "Quote", hotel.stay.quoteId, undefined, { hotelId: hotel.id, agencyPick: !hotel.agencyPick }, tx);
    return { ok: true, id: hotel.stay.quoteId } as const;
  });
}

export async function removeHotel(actorUserId: string, agencyId: string, hotelId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const hotel = await lockedHotel(tx, agencyId, hotelId);
    if (isResult(hotel)) return hotel;
    if (await stayHasActiveBooking(tx, hotel.stayId)) return fail(STAY_BOOKED);
    await tx.quoteHotel.delete({ where: { id: hotel.id } });
    await afterRemoval(tx, hotel.stay.quoteId, actorUserId);
    await touch(tx, hotel.stay.quoteId);
    await audit(actorUserId, "quote.hotel.remove", "Quote", hotel.stay.quoteId, { hotelId: hotel.id }, undefined, tx);
    return { ok: true, id: hotel.stay.quoteId } as const;
  });
}

// ---------- room options ----------

async function ownRoom(tx: Prisma.TransactionClient, agencyId: string, roomId: string) {
  if (typeof roomId !== "string" || roomId.length > 64) return null;
  return tx.quoteRoom.findFirst({
    where: { id: roomId, hotel: { stay: { quote: { agencyId } } } },
    select: { id: true, refundable: true, freeCancelUntil: true, netMinor: true, currency: true, hotel: { select: { stayId: true, stay: { select: { quoteId: true } } } } },
  });
}

// "" = back to the quote's markup; otherwise USD with up to 2 decimals, above 0 and up to
// 1,000,000. A price below the room's net (a sale at a loss) is saved only with the agent's
// explicit yes (`confirmBelowNet`): a slipped digit must not reach the client.
export async function setRoomPrice(
  actorUserId: string,
  agencyId: string,
  roomId: string,
  raw: string,
  options: { confirmBelowNet?: boolean } = {},
): Promise<Result> {
  const value = raw.trim();
  let sellMinor: number | null = null;
  if (value !== "") {
    const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.replace(/,/g, ""));
    if (!m) return fail("Type the selling price in USD, for example 1284 or 1284.50.");
    sellMinor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
    if (sellMinor > 100_000_000) return fail("Type the selling price in USD, for example 1284 or 1284.50.");
    if (sellMinor === 0) return fail("The selling price cannot be 0. Type a price, or empty the field to use the markup.");
  }
  return db.$transaction(async (tx) => {
    const room = await ownRoom(tx, agencyId, roomId);
    const quoteId = room?.hotel.stay.quoteId;
    if (!room || !quoteId) return fail(NOT_FOUND);
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    // A booked destination is frozen: its price is the booking's.
    if (await stayHasActiveBooking(tx, room.hotel.stayId)) return fail(STAY_BOOKED);
    if (sellMinor !== null && sellMinor < room.netMinor && options.confirmBelowNet !== true) {
      return {
        ok: false,
        error: `This price is below your net price (${formatMinor(room.netMinor, room.currency)}): you would sell at a loss. Tick the box and choose Set again to keep it.`,
        confirm: "belowNet",
      } as const;
    }
    await tx.quoteRoom.update({ where: { id: room.id }, data: { sellMinor } });
    await touch(tx, quoteId);
    await audit(actorUserId, "quote.room.price", "Quote", quoteId, undefined, { roomId: room.id, sellMinor }, tx);
    return { ok: true, id: quoteId } as const;
  });
}

export async function setClientCancelDate(
  actorUserId: string,
  agencyId: string,
  roomId: string,
  date: string,
  now: Date = new Date(),
): Promise<Result> {
  return db.$transaction(async (tx) => {
    const room = await ownRoom(tx, agencyId, roomId);
    const quoteId = room?.hotel.stay.quoteId;
    if (!room || !quoteId) return fail(NOT_FOUND);
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    // A booked destination is frozen: the client was told this date when it was booked.
    if (await stayHasActiveBooking(tx, room.hotel.stayId)) return fail(STAY_BOOKED);
    if (!room.refundable || !room.freeCancelUntil) return fail("This room has no free cancellation.");
    if (!clientDateAllowed(date, room.freeCancelUntil, todayIso(now))) {
      return fail("Choose a date after today and at least one day before the supplier's deadline: that day is kept to cancel for the client.");
    }
    await tx.quoteRoom.update({ where: { id: room.id }, data: { clientCancelUntil: date } });
    await touch(tx, quoteId);
    await audit(actorUserId, "quote.room.client-date", "Quote", quoteId, undefined, { roomId: room.id, clientCancelUntil: date }, tx);
    return { ok: true, id: quoteId } as const;
  });
}

export async function removeRoom(actorUserId: string, agencyId: string, roomId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const room = await ownRoom(tx, agencyId, roomId);
    const quoteId = room?.hotel.stay.quoteId;
    if (!room || !quoteId) return fail(NOT_FOUND);
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
    if (quote === "closed") return fail(CLOSED);
    if (await stayHasActiveBooking(tx, room.hotel.stayId)) return fail(STAY_BOOKED);
    await tx.quoteRoom.delete({ where: { id: room.id } });
    await afterRemoval(tx, quoteId, actorUserId);
    await touch(tx, quoteId);
    await audit(actorUserId, "quote.room.remove", "Quote", quoteId, { roomId: room.id }, undefined, tx);
    return { ok: true, id: quoteId } as const;
  });
}

// ---------- add from a search ----------

const addInput = z
  .object({
    quoteId: z.string().max(64), // "new" = a new quote
    snapshotId: z.string().min(1).max(64),
    propertyId: z.string().min(1).max(64),
    rateId: z.string().min(1).max(128),
    bedGroupId: z.string().min(1).max(128),
  })
  .strict();

// Copies one rate of the agency's own, unexpired search into a quote. Everything is read on the
// server from the search; the browser only names the rate.
export async function addFromSearch(
  actorUserId: string,
  agencyId: string,
  rawInput: z.input<typeof addInput>,
  now: Date = new Date(),
): Promise<Result> {
  const parsed = addInput.safeParse(rawInput);
  if (!parsed.success) return fail("Search again and choose the room.");
  const input = parsed.data;
  const found = await findOffer(agencyId, { snapshotId: input.snapshotId, propertyId: input.propertyId, rateId: input.rateId, bedGroupId: input.bedGroupId }, now);
  if (!found) return fail("These prices expired (they are kept for 30 minutes). Search again.");
  const { offer, bedGroup, hotel, query, rooms } = found;
  // Plan 10: a quote is for one room (several-room quotes are plan 10b).
  if (rooms.length > 1) return fail(QUOTES_ONE_ROOM);
  const destination = await db.destination.findUnique({ where: { id: query.destinationId }, select: { id: true, nameFull: true } });
  if (!destination) return fail("Search again and choose the room.");
  const property = await db.property.findUnique({ where: { id: offer.propertyId }, select: { starRating: true } });

  let quoteId = input.quoteId;
  try {
    return await db.$transaction(async (tx) => {
      if (quoteId === "new") {
        // A new quote is created in the same transaction, so a refusal below leaves nothing behind.
        const created = await tx.quote.create({
          data: { agencyId, agencyNumber: await nextAgencyNumber(tx, agencyId), createdById: actorUserId, adults: query.adults, childAges: query.childAges, ...(await newQuoteDefaults(tx, agencyId)) },
          select: { id: true },
        });
        await audit(actorUserId, "quote.create", "Quote", created.id, undefined, undefined, tx);
        quoteId = created.id;
      }
      const quote = await lockQuote(tx, agencyId, quoteId);
      if (!quote) return fail(NOT_FOUND);
      if (quote.status === "BOOKED") return fail("This quote is already booked. Choose another quote or a new one.");
      if (quote.closedAt) return fail("This quote is closed. Reopen it, or choose another quote or a new one.");
      const sameGuests = quote.adults === query.adults && quote.childAges.join(",") === query.childAges.join(",");
      if (!sameGuests) {
        if ((await roomCount(tx, quoteId)) > 0) {
          return fail("This search is for other guests than the quote. Search with the quote's guests.");
        }
        await tx.quote.update({ where: { id: quoteId }, data: { adults: query.adults, childAges: query.childAges } });
      }

      let stay = await tx.quoteStay.findFirst({
        where: { quoteId, destinationId: destination.id, checkin: query.checkin, checkout: query.checkout },
        select: { id: true },
      });
      if (!stay) {
        const stayId = await createStay(tx, quoteId, destination, query.checkin, query.checkout);
        if (!stayId) return fail(`A quote can have up to ${MAX_STAYS} destinations.`);
        stay = { id: stayId };
      }
      // A booked destination is frozen (no new hotels or rooms), like removing from it.
      if (await stayHasActiveBooking(tx, stay.id)) return fail(STAY_BOOKED);

      let quoteHotel = await tx.quoteHotel.findUnique({ where: { stayId_propertyId: { stayId: stay.id, propertyId: offer.propertyId } }, select: { id: true } });
      if (!quoteHotel) {
        if ((await tx.quoteHotel.count({ where: { stayId: stay.id } })) >= MAX_HOTELS_PER_STAY) {
          return fail(`A destination can have up to ${MAX_HOTELS_PER_STAY} hotels.`);
        }
        const last = await tx.quoteHotel.findFirst({ where: { stayId: stay.id }, orderBy: { position: "desc" }, select: { position: true } });
        quoteHotel = await tx.quoteHotel.create({
          data: {
            stayId: stay.id,
            propertyId: offer.propertyId,
            name: hotel.name,
            city: hotel.city,
            starRating: property?.starRating ?? null,
            position: (last?.position ?? -1) + 1,
          },
          select: { id: true },
        });
      }

      const existing = await tx.quoteRoom.findUnique({
        where: { hotelId_rateId_bedGroupId: { hotelId: quoteHotel.id, rateId: offer.rateId, bedGroupId: bedGroup.id } },
        select: { id: true },
      });
      if (!existing) {
        if ((await tx.quoteRoom.count({ where: { hotelId: quoteHotel.id } })) >= MAX_ROOMS_PER_HOTEL) {
          return fail(`A hotel can have up to ${MAX_ROOMS_PER_HOTEL} room options.`);
        }
        const last = await tx.quoteRoom.findFirst({ where: { hotelId: quoteHotel.id }, orderBy: { position: "desc" }, select: { position: true } });
        const freeCancelUntil = lastFreeDay(offer);
        const today = todayIso(now);
        const clientDefault = freeCancelUntil ? defaultClientDate(freeCancelUntil) : null;
        await tx.quoteRoom.create({
          data: {
            hotelId: quoteHotel.id,
            roomId: offer.roomId,
            rateId: offer.rateId,
            bedGroupId: bedGroup.id,
            roomName: offer.roomName,
            bedDescription: bedGroup.description,
            amenities: offer.amenities,
            // The supplier's own flag, as given (so the same kind of rate can be found again when
            // booking). Whether free cancellation is still open is worked out from the dates
            // each time it is shown (pricing.ts), never frozen here.
            refundable: offer.refundable,
            freeCancelUntil,
            // One day before the supplier's, if that day is still ahead; else the client is
            // shown no free cancellation at all.
            clientCancelUntil: clientDefault && dayAhead(clientDefault, today) ? clientDefault : null,
            netMinor: offer.price.total.minor,
            currency: offer.price.total.currency,
            price: offer.price as unknown as Prisma.InputJsonValue,
            position: (last?.position ?? -1) + 1,
          },
        });
      }
      await touch(tx, quoteId);
      await audit(actorUserId, "quote.room.add", "Quote", quoteId, undefined, { propertyId: offer.propertyId, rateId: offer.rateId }, tx);
      return { ok: true, id: quoteId } as const;
    });
  } catch (error) {
    // Two clicks at the same moment on an existing quote: the unique index on the room keeps one
    // copy of the rate. Anything else (or a new quote, whose id was rolled back) is a real error.
    const roomIndex =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      JSON.stringify(error.meta ?? {}).includes("rateId") &&
      input.quoteId !== "new";
    if (roomIndex) return { ok: true, id: input.quoteId };
    throw error;
  }
}

// ---------- totals shown on the editor ----------

export function quoteNumbers(quote: Pick<QuoteDetail, "markupType" | "markupValue" | "stays">) {
  const rooms = quote.stays.flatMap((s) => s.hotels.flatMap((h) => h.rooms));
  const sells = rooms.map((r) => sellingMinor(r, quote));
  const profits = rooms.map((r, i) => (sells[i] ?? 0) - r.netMinor);
  return {
    options: rooms.length,
    lowestSell: sells.length ? Math.min(...sells) : null,
    profitMin: profits.length ? Math.min(...profits) : null,
    profitMax: profits.length ? Math.max(...profits) : null,
  };
}

import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { findOffer } from "@/server/search/search";
import { clientDateAllowed, defaultClientDate, lastFreeDay, parseMarkup, sellingMinor } from "@/server/quotes/pricing";

// Quotes (screens 14, 15; plan 5b). Every function takes the agencyId from the caller's session
// (requireAgent), never from the request. A quote, destination, hotel or room of another agency is
// never found or changed: child rows are always looked up through their quote's agencyId (no
// IDOR). The audit log records ids and what kind of change happened, never a client's details.

export const QUOTE_PAGE_SIZE = 20;
export const MAX_STAYS = 10;
export const MAX_HOTELS_PER_STAY = 20;
export const MAX_ROOMS_PER_HOTEL = 10;

export const QUOTE_TABS = ["all", "draft", "sent", "viewed", "selected", "booked"] as const;
export type QuoteTab = (typeof QUOTE_TABS)[number];
const TAB_STATUS = { draft: "DRAFT", sent: "SENT", viewed: "VIEWED", selected: "SELECTED", booked: "BOOKED" } as const;

export type Result = { ok: true; id: string } | { ok: false; error: string };

const fail = (error: string): Result => ({ ok: false, error });

const NOT_FOUND = "This quote was not found.";

export function quoteCode(number: number): string {
  return `Q-${number}`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

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
      data: { agencyId: agency.id, createdById: actorUserId, clientId },
      select: { id: true },
    });
    await audit(actorUserId, "quote.create", "Quote", quote.id, undefined, undefined, tx);
    return quote.id;
  });
  return { ok: true, id };
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
  updatedAt: Date;
};

export type QuotePage = { quotes: QuoteListItem[]; nextCursor: string | null };

// Newest change first, 20 per page. The cursor must be one of the agency's own quotes.
export async function listQuotes(
  agencyId: string,
  options: { tab?: QuoteTab | undefined; q?: string | undefined; cursor?: string | undefined; clientId?: string | undefined },
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
      ...(number ? [{ number: Number(number[1]) }] : []),
    ];
  }
  const cursor = options.cursor
    ? ((await db.quote.findFirst({ where: { id: options.cursor, agencyId }, select: { id: true } }))?.id ?? null)
    : null;
  const rows = await db.quote.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: QUOTE_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      adults: true,
      childAges: true,
      sentAt: true,
      viewedAt: true,
      selectedAt: true,
      updatedAt: true,
      client: { select: { firstName: true, lastName: true, email: true } },
      stays: {
        orderBy: { position: "asc" },
        select: { destinationName: true, checkin: true, checkout: true, hotels: { select: { _count: { select: { rooms: true } } } } },
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
        number: row.number,
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
        updatedAt: row.updatedAt,
      };
    }),
    nextCursor: rows.length > QUOTE_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

const quoteDetailSelect = {
  id: true,
  number: true,
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
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  stays: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      destinationId: true,
      destinationName: true,
      checkin: true,
      checkout: true,
      selectedRoomId: true,
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
  return db.quote.findFirst({ where: { id: quoteId, agencyId }, select: quoteDetailSelect });
}

// The agency's quotes that can still take rooms (not booked), newest first, for "Add to quote".
// `include`: one more quote that must be in the list even if it is older (the quote the agent came
// from, "+ Add hotel"), if it is the agency's own and not booked.
export async function openQuotes(agencyId: string, include?: string | null): Promise<{ id: string; number: number; title: string }[]> {
  const select = { id: true, number: true, title: true } as const;
  const latest = await db.quote.findMany({
    where: { agencyId, status: { not: "BOOKED" } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 30,
    select,
  });
  if (!include || latest.some((q) => q.id === include)) return latest;
  const extra = await db.quote.findFirst({ where: { id: include, agencyId, status: { not: "BOOKED" } }, select });
  return extra ? [extra, ...latest] : latest;
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
  })
  .strict();

export type QuoteSettingsInput = z.input<typeof quoteSettingsInput>;

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
    const guestsChanged = quote.adults !== input.adults || quote.childAges.join(",") !== input.childAges.join(",");
    if (guestsChanged && (await roomCount(tx, quoteId)) > 0) {
      return fail("The guests cannot change once the quote has rooms: the prices are for these guests. Remove the rooms first.");
    }
    await tx.quote.update({
      where: { id: quoteId },
      data: {
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
    await audit(actorUserId, "quote.settings", "Quote", quoteId, undefined, undefined, tx);
    return { ok: true, id: quoteId } as const;
  });
}

// Locks the quote row for the rest of the transaction, and proves it belongs to the agency.
async function lockQuote(tx: Prisma.TransactionClient, agencyId: string, quoteId: string) {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Quote" WHERE id = ${quoteId} AND "agencyId" = ${agencyId} FOR UPDATE`;
  if (rows.length === 0) return null;
  return tx.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { id: true, status: true, adults: true, childAges: true } });
}

const BOOKED = "This quote is booked and can no longer change.";

// Locks the quote for an edit. null: not the agency's quote; "booked": it can no longer change.
async function lockForEdit(tx: Prisma.TransactionClient, agencyId: string, quoteId: string) {
  const quote = await lockQuote(tx, agencyId, quoteId);
  if (!quote) return null;
  return quote.status === "BOOKED" ? ("booked" as const) : quote;
}

async function roomCount(tx: Prisma.TransactionClient, quoteId: string): Promise<number> {
  return tx.quoteRoom.count({ where: { hotel: { stay: { quoteId } } } });
}

async function touch(tx: Prisma.TransactionClient, quoteId: string): Promise<void> {
  await tx.quote.update({ where: { id: quoteId }, data: { updatedAt: new Date() } });
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
    await tx.quoteStay.delete({ where: { id: stay.id } });
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
    await tx.quoteHotel.delete({ where: { id: hotel.id } });
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
    select: { id: true, freeCancelUntil: true, hotel: { select: { stay: { select: { quoteId: true } } } } },
  });
}

// "" = back to the quote's markup; otherwise USD with up to 2 decimals, up to 1,000,000.
export async function setRoomPrice(actorUserId: string, agencyId: string, roomId: string, raw: string): Promise<Result> {
  const value = raw.trim();
  let sellMinor: number | null = null;
  if (value !== "") {
    const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.replace(/,/g, ""));
    if (!m) return fail("Type the selling price in USD, for example 1284 or 1284.50.");
    sellMinor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
    if (sellMinor > 100_000_000) return fail("Type the selling price in USD, for example 1284 or 1284.50.");
  }
  return db.$transaction(async (tx) => {
    const room = await ownRoom(tx, agencyId, roomId);
    const quoteId = room?.hotel.stay.quoteId;
    if (!room || !quoteId) return fail(NOT_FOUND);
    const quote = await lockForEdit(tx, agencyId, quoteId);
    if (!quote) return fail(NOT_FOUND);
    if (quote === "booked") return fail(BOOKED);
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
    if (!room.freeCancelUntil) return fail("This room has no free cancellation.");
    if (!clientDateAllowed(date, room.freeCancelUntil, todayIso(now))) {
      return fail("Choose a date from today up to the supplier's deadline, never later.");
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
    await tx.quoteRoom.delete({ where: { id: room.id } });
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
  const { offer, bedGroup, hotel, query } = found;
  const destination = await db.destination.findUnique({ where: { id: query.destinationId }, select: { id: true, nameFull: true } });
  if (!destination) return fail("Search again and choose the room.");
  const property = await db.property.findUnique({ where: { id: offer.propertyId }, select: { starRating: true } });

  let quoteId = input.quoteId;
  try {
    return await db.$transaction(async (tx) => {
      if (quoteId === "new") {
        // A new quote is created in the same transaction, so a refusal below leaves nothing behind.
        const created = await tx.quote.create({
          data: { agencyId, createdById: actorUserId, adults: query.adults, childAges: query.childAges },
          select: { id: true },
        });
        await audit(actorUserId, "quote.create", "Quote", created.id, undefined, undefined, tx);
        quoteId = created.id;
      }
      const quote = await lockQuote(tx, agencyId, quoteId);
      if (!quote) return fail(NOT_FOUND);
      if (quote.status === "BOOKED") return fail("This quote is already booked. Choose another quote or a new one.");
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
            refundable: offer.refundable && freeCancelUntil !== null && freeCancelUntil >= today,
            freeCancelUntil,
            clientCancelUntil: clientDefault && clientDefault >= today ? clientDefault : freeCancelUntil,
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

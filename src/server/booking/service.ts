import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Booking, BookingRoom, BookingStatus, Prisma } from "@/generated/prisma/client";
import { formatUsd } from "@/lib/money";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { hitRateLimit } from "@/server/rate-limit";
import { QuoteStayAlreadyBooked, QuoteStayChanged, claimQuoteStay, lockQuoteOfBooking, stayForDraft, syncQuoteOfBooking } from "@/server/quotes/quote-booking";
import { SEVERAL_ROOMS_UNAVAILABLE } from "@/server/search/errors";
import { MAX_ROOMS } from "@/server/search/input";
import { findOffer } from "@/server/search/search";
import { bookingSupplier, multiRoomAllowed } from "@/server/supplier";
import { SupplierAuthError, SupplierError, SupplierNotSent, SupplierRateLimited, SupplierRequestRejected } from "@/server/supplier/expedia/client";
import type { BookingSupplier, CancelPenalty, PriceBreakdown, RetrievedItinerary, SupplierAdapter, SupplierContext, SupplierLinks } from "@/server/supplier/types";
import { audit } from "@/server/audit";
import { captureHold, credit, creditInTx, getBalance, placeHoldInTx, releaseHold, withLedgerTransaction } from "@/server/wallet/ledger";
import { HoldNotOpen, InsufficientFunds } from "@/server/wallet/errors";
import { CANCEL_MARGIN_MS, cancelChargeAt, cancelChargeForRooms } from "./cancel-charge";
import type { BookingEmailEvent } from "./emails";
import { quotedMarkup } from "./selling";
import { BookingStateConflict, transition } from "./states";

// Booking (plan 3). The money rules, in order:
//   1. The price is never taken from the browser: the rate comes from the agency's own search,
//      and the price is checked again with the supplier on the review page.
//   2. Booking places a hold first (idempotency key from the booking id), then moves the booking
//      DRAFT → PENDING_CONFIRMATION with a conditional update: a double click books once.
//   3. Supplier yes → capture (HOLD_RELEASE + CHARGE) → CONFIRMED. A definite no → release →
//      FAILED. No clear answer → stay PENDING_CONFIRMATION with the hold, and reconcile later
//      by affiliate reference. Never book again.
//   4. Cancellation refunds (total − today's charge) only after the supplier confirms it.
//   5. A booking is confirmed (and charged) only when the supplier shows every room "booked".
//      A room pending there: look again later. Anything else: an admin looks, the money stays
//      held, and the checks go on. A check never stops for good: after the first hour and a half
//      it runs every hour, and a sweeper (upkeep.ts) makes sure a waiting booking always has one.
// Every read and write is scoped by the session's agencyId.
// Several rooms (plan 10): a booking has 1 to 8 rooms (BookingRoom), each with its own guests and
// its own supplier price; the booking keeps the totals. The rooms always add up to the booking's
// total, and nothing is held or sent when they do not. One hold, one charge for the booking.

export type BookingContext = { agencyId: string; userId: string; supplierContext: SupplierContext };
type Supplier = SupplierAdapter & BookingSupplier;
type Deps = { supplier?: Supplier; now?: Date };

export class BookingInputInvalid extends Error {}
export class BookingNotFound extends Error {}
export class BookingRateExpired extends Error {}
export class BookingUnavailable extends Error {}
class BookingChangedSinceRead extends Error {}

const PRICE_CHECK_VALID_MS = 10 * 60_000; // the book button needs a price check this recent
// The review page asks the supplier again only when its last price check is at least this old,
// and at most this many times per booking in a while (a page left reloading, or a script).
const PRICE_CHECK_FRESH_MS = 60_000;
const PRICE_CHECK_LIMIT = { limit: 12, windowMs: 10 * 60_000 };
const RECONCILE_DELAY_MS = 2 * 60_000;
const QUICK_RECHECK_MS = 30_000; // the supplier accepted the booking but its status could not be read yet
const QUICK_RECHECKS = 4;
const SAFETY_NET_MS = 5 * 60_000; // queued with every pending change, before the supplier call
const CANCEL_RESTORE_AFTER_MS = 30 * 60_000; // a cancellation still "booked" this long after the request did not go through
// After a cancellation was put back, the supplier is looked at again at these times: a
// cancellation that went through late after all is then finished properly.
const HOUR_MS = 3_600_000;
export const RESTORE_WATCH_MS = 24 * HOUR_MS;
const RESTORE_CHECKS_MS = [1, 3, 6, 12, 24].map((hours) => hours * HOUR_MS);
// "Not found" twice, this far apart, means no booking. Rapid says a new itinerary may take a few
// minutes before it can be found, so the gap is generous.
const NOT_FOUND_CONFIRM_MS = 20 * 60_000;

// A definite "no": the supplier refused, or nothing was sent. Anything else is "not known".
function definiteNo(error: unknown): error is SupplierError {
  return error instanceof SupplierRequestRejected || error instanceof SupplierAuthError || error instanceof SupplierRateLimited || error instanceof SupplierNotSent;
}
// The check of a booking without a clear answer never stops. The first 48 tries are a few
// minutes apart; then an admin is told (once) and it goes on every hour for 7 days, and every
// 6 hours after that, until the supplier answers or an admin settles the booking.
const FAST_RECONCILE_ATTEMPTS = 48;
const HOURLY_RECONCILE_ATTEMPTS = 7 * 24;
const HOURLY_RECONCILE_MS = HOUR_MS;
const SLOWEST_RECONCILE_MS = 6 * HOUR_MS;
// A booking failed because the supplier did not have it is looked up again this long after: an
// itinerary that turns up late is a room booked there that nobody paid for.
const NOT_FOUND_REASON = "Reconciled: supplier has no such booking";
const LATE_NOT_FOUND_CHECKS_MS = [6 * HOUR_MS, 24 * HOUR_MS];
const LATE_NOT_FOUND_GIVE_UP_MS = 48 * HOUR_MS;

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function newReference(): string {
  let out = "APL-";
  for (let i = 0; i < 8; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

const name = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[\p{L}][\p{L}\p{M} '.-]*$/u); // letters, spaces, apostrophes, dots and hyphens
// Title (Mr/Mrs/Ms) is for the agency's documents (voucher); Rapid takes no title.
const guestSchema = z.object({ givenName: name, familyName: name, title: z.enum(["MR", "MRS", "MS"]).optional() }).strict();

// Special requests (screen 10): sent to the hotel in Rapid's special_request (not guaranteed).
// Rapid forbids personal or payment details there, so long digit runs (an ID, a card or a phone
// number) are refused, and the text is plain, one line, without Rapid's re-encoded characters.
export const SPECIAL_REQUESTS = {
  EARLY_CHECKIN: "Early check-in",
  LATE_CHECKOUT: "Late check-out",
  HIGH_FLOOR: "High floor",
  HONEYMOON: "Honeymoon",
} as const;
const specialRequestsSchema = z
  .object({
    options: z.array(z.enum(Object.keys(SPECIAL_REQUESTS) as [keyof typeof SPECIAL_REQUESTS, ...(keyof typeof SPECIAL_REQUESTS)[]])).max(4),
    // Rapid re-encodes < > ( ) &: they are simply left out instead of refusing the request.
    text: z
      .string()
      .transform((v) => v.normalize("NFKC").replace(/[<>()&]/g, " ").replace(/\s+/g, " ").trim())
      .pipe(z.string().max(300).refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v))),
  })
  .strict();

const REQUEST_MAX = 300;

// What may not go to the hotel (Rapid: no personal or payment details): 6 or more digits in a
// row once spaces, dots, slashes and other separators are removed (any script's digits), or an
// email address.
export function requestHasPersonalDetails(text: string): boolean {
  const compact = text.normalize("NFKC").replace(/[^\p{L}\p{N}@]/gu, "");
  return /\p{Nd}{6,}/u.test(compact) || text.includes("@");
}

// When free cancellation ends: the start of the first charge (an instant, from the hotel's time
// with its offset), less the safety margin the charge itself is worked out with (cancel-charge.ts).
// null: non-refundable, or no charge listed.
// Same as the cancel screen: nights that cannot be refunded, or a date that cannot be read, mean
// no free-cancellation promise at all.
export function freeCancelEnds(offer: { refundable: boolean; cancelPenalties: CancelPenalty[]; nonrefundableDateRanges?: unknown[] }): Date | null {
  if (!offer.refundable || (offer.nonrefundableDateRanges?.length ?? 0) > 0) return null;
  const starts = offer.cancelPenalties.map((p) => Date.parse(p.start));
  if (starts.length === 0 || starts.some((t) => !Number.isFinite(t))) return null;
  return new Date(Math.min(...starts) - CANCEL_MARGIN_MS);
}

export function specialRequestText(input: z.infer<typeof specialRequestsSchema> | undefined): string {
  if (!input) return "";
  const parts = [...new Set(input.options)].map((o) => `${SPECIAL_REQUESTS[o]}.`);
  if (input.text) parts.push(input.text);
  return parts.join(" ");
}

export const draftInputSchema = z
  .object({
    snapshotId: z.string().min(1).max(64),
    propertyId: z.string().min(1).max(64),
    rateId: z.string().min(1).max(128),
    bedGroupId: z.string().min(1).max(128),
    // One entry per searched room, in room order: that room's adults, then its children (TR5:
    // the first adult is the room's main guest; room 1's is the lead guest).
    rooms: z.array(z.object({ guests: z.array(guestSchema).min(1).max(14) }).strict()).min(1).max(MAX_ROOMS),
    leadEmail: z.string().trim().toLowerCase().max(254).email(),
    leadPhone: z.object({ countryCode: z.string().regex(/^\d{1,3}$/), number: z.string().regex(/^\d{4,14}$/) }).strict(),
    // Plan 5d: the quote's destination this booking comes from (the agency's own, not yet booked).
    quoteStayId: z.string().regex(/^[a-z0-9]{20,40}$/).optional(),
    specialRequests: specialRequestsSchema.optional(),
  })
  .strict();
export type DraftInput = z.infer<typeof draftInputSchema>;

function supplierOf(deps: Deps): Supplier {
  return deps.supplier ?? bookingSupplier();
}

// The agent's IP address and browser, kept on the booking when it is entered, booked or
// cancelled: the supplier asks for them on every call (Customer-Ip, User-Agent), also the ones
// made later in the background, where there is no request to read them from.
function agentOf(context: SupplierContext): { agentIp?: string; agentUserAgent?: string } {
  return { ...(context.customerIp ? { agentIp: context.customerIp.slice(0, 64) } : {}), ...(context.userAgent ? { agentUserAgent: context.userAgent.slice(0, 255) } : {}) };
}
export function supplierContextOf(booking: Pick<Booking, "agentIp" | "agentUserAgent">): SupplierContext {
  return { ...(booking.agentIp ? { customerIp: booking.agentIp } : {}), ...(booking.agentUserAgent ? { userAgent: booking.agentUserAgent } : {}) };
}

// Room prices add up to a total exactly, in its currency (addition only, BP5).
function pricesAddUp(rooms: PriceBreakdown[], total: { minor: number; currency: string }): boolean {
  let sum = 0;
  for (const room of rooms) {
    if (room.total.currency !== total.currency) return false;
    sum += room.total.minor;
  }
  return Number.isSafeInteger(sum) && sum === total.minor;
}

// A booking's rooms in room order (through the booking, so the agency scope holds).
export function roomsOf(booking: Pick<Booking, "id" | "agencyId">): Promise<BookingRoom[]> {
  return db.bookingRoom.findMany({ where: { bookingId: booking.id, booking: { agencyId: booking.agencyId } }, orderBy: { index: "asc" } });
}

// The rooms are exactly the booking: numbered from 0, 1 to 8 of them, the booking's guests
// counted once, and their totals adding up to the booking's total.
function roomsMatchBooking(booking: Booking, rooms: BookingRoom[]): boolean {
  if (rooms.length < 1 || rooms.length > MAX_ROOMS || rooms.some((room, i) => room.index !== i)) return false;
  if (rooms.reduce((n, room) => n + room.adults, 0) !== booking.adults) return false;
  if (rooms.flatMap((room) => room.childAges).join(",") !== booking.childAges.join(",")) return false;
  const sum = rooms.reduce((n, room) => n + room.totalMinor, 0);
  return Number.isSafeInteger(sum) && sum === booking.totalMinor;
}

async function ownBooking(agencyId: string, bookingId: string): Promise<Booking> {
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new BookingNotFound();
  const booking = await db.booking.findFirst({ where: { id: bookingId, agencyId } });
  if (!booking) throw new BookingNotFound();
  return booking;
}

// The rooms of the agency's own booking, in room order (none for another agency's booking), for
// the pages: without the supplier's cancel link, which stays on the server.
export type BookingRoomView = Omit<BookingRoom, "cancelLink">;
export async function getBookingRooms(agencyId: string, bookingId: string): Promise<BookingRoomView[]> {
  if (typeof bookingId !== "string" || bookingId.length > 64) return [];
  return db.bookingRoom.findMany({ where: { bookingId, booking: { agencyId } }, orderBy: { index: "asc" }, omit: { cancelLink: true } });
}

export async function getBooking(agencyId: string, bookingId: string): Promise<Booking | null> {
  try {
    return await ownBooking(agencyId, bookingId);
  } catch (error) {
    if (error instanceof BookingNotFound) return null;
    throw error;
  }
}

// Screen 10: guest details → a DRAFT booking with the rate exactly as the search priced it.
export async function createDraft(ctx: BookingContext, rawInput: unknown, deps: Deps = {}): Promise<{ bookingId: string }> {
  const now = deps.now ?? new Date();
  const parsed = draftInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new BookingInputInvalid("Check the guest names, email and phone.");
  const input = parsed.data;
  const specialRequest = specialRequestText(input.specialRequests);
  if (requestHasPersonalDetails(specialRequest)) {
    throw new BookingInputInvalid("Special requests go to the hotel: write no ID, card or phone numbers or email addresses there.");
  }
  if (specialRequest.length > REQUEST_MAX) throw new BookingInputInvalid(`Special requests can be up to ${REQUEST_MAX} characters in all. Shorten the additional request.`);
  const found = await findOffer(ctx.agencyId, { snapshotId: input.snapshotId, propertyId: input.propertyId, rateId: input.rateId, bedGroupId: input.bedGroupId }, now);
  if (!found) throw new BookingRateExpired("These prices expired. Search again for current prices.");
  const { offer, bedGroup, hotel, query, rooms } = found;
  if (rooms.length > 1 && !multiRoomAllowed()) throw new BookingInputInvalid(SEVERAL_ROOMS_UNAVAILABLE);
  // Every searched room, each with exactly its own adults and children.
  if (input.rooms.length !== rooms.length || input.rooms.some((room, i) => room.guests.length !== rooms[i]!.adults + rooms[i]!.childAges.length)) {
    throw new BookingInputInvalid("Enter a name for every guest.");
  }
  // One stored price per room, adding up to the offer's price (the search read checks it too).
  if (offer.roomPrices.length !== rooms.length || !pricesAddUp(offer.roomPrices, offer.price.total)) {
    throw new BookingRateExpired("These prices expired. Search again for current prices.");
  }
  const guests = input.rooms.flatMap((room) => room.guests);
  const lead = guests[0]!;
  let fromQuote: { quoteId: string; quoteStayId: string; sellMinor: number | null } | null = null;
  if (input.quoteStayId) {
    // Quotes are for one room (plan 10).
    if (rooms.length > 1) throw new BookingInputInvalid("This rate is not the dates or hotel of this quote. Open the quote and choose Book again.");
    const stay = await stayForDraft(ctx.agencyId, input.quoteStayId, { propertyId: offer.propertyId, ...query });
    if (stay === "not_found") throw new BookingInputInvalid("This quote was not found, or it is already booked.");
    if (stay === "mismatch") throw new BookingInputInvalid("This rate is not the dates or hotel of this quote. Open the quote and choose Book again.");
    fromQuote = stay;
  }
  const data = {
    agencyId: ctx.agencyId,
    quoteId: fromQuote?.quoteId ?? null,
    quoteStayId: fromQuote?.quoteStayId ?? null,
    // From a quote: the price the client was quoted, with the markup that shows it on this net.
    sellMinor: fromQuote?.sellMinor ?? null,
    ...(fromQuote && fromQuote.sellMinor !== null ? quotedMarkup(fromQuote.sellMinor, offer.price.total.minor) : { sellMarkupType: null, sellMarkupValue: null }),
    userId: ctx.userId,
    snapshotId: input.snapshotId,
    propertyId: offer.propertyId,
    hotelName: hotel.name,
    hotelCity: hotel.city,
    roomId: offer.roomId,
    roomName: offer.roomName,
    rateId: offer.rateId,
    bedGroupId: bedGroup.id,
    bedDescription: bedGroup.description,
    amenities: offer.amenities,
    checkin: query.checkin,
    checkout: query.checkout,
    adults: query.adults,
    childAges: query.childAges,
    leadGivenName: lead.givenName,
    leadFamilyName: lead.familyName,
    leadEmail: input.leadEmail,
    leadPhone: `+${input.leadPhone.countryCode} ${input.leadPhone.number}`,
    specialRequest,
    guests,
    refundable: offer.refundable,
    totalMinor: offer.price.total.minor,
    currency: offer.price.total.currency,
    price: offer.price as unknown as Prisma.InputJsonValue,
    cancelPenalties: offer.cancelPenalties as unknown as Prisma.InputJsonValue,
    freeCancelEndsAt: freeCancelEnds(offer),
    nonrefundableDateRanges: offer.nonrefundableDateRanges as unknown as Prisma.InputJsonValue,
    priceCheckToken: bedGroup.priceCheckToken,
    ...agentOf(ctx.supplierContext),
  };
  const roomRows = rooms.map((occupancy, index) => {
    const roomGuests = input.rooms[index]!.guests;
    const price = offer.roomPrices[index]!;
    return {
      index,
      adults: occupancy.adults,
      childAges: occupancy.childAges,
      guests: roomGuests,
      givenName: roomGuests[0]!.givenName,
      familyName: roomGuests[0]!.familyName,
      totalMinor: price.total.minor,
      price: price as unknown as Prisma.InputJsonValue,
    };
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const booking = await tx.booking.create({ data: { ...data, reference: newReference() }, select: { id: true } });
        await tx.bookingRoom.createMany({ data: roomRows.map((room) => ({ ...room, bookingId: booking.id })) });
        await tx.bookingEvent.create({ data: { bookingId: booking.id, toStatus: "DRAFT", actorUserId: ctx.userId, reason: "Guest details entered" } });
        return booking;
      });
      return { bookingId: created.id };
    } catch (error) {
      // A reference collision (1 in 32^8) retries with a new one; anything else is real.
      const unique = (error as { code?: string }).code === "P2002";
      if (!unique || attempt >= 2) throw error;
    }
  }
}

export type ReviewOutcome =
  | { kind: "ready"; booking: Booking; priceChanged: boolean }
  | { kind: "sold_out"; booking: Booking }
  | { kind: "not_draft"; booking: Booking };

// Screen 11: checks the price again with the supplier (server-side token), and records the
// result on the draft. A changed price is kept with the old one, for the "old vs new" view.
// The write is conditional on the booking still being a DRAFT: a book that ran during the
// price check is never given another price afterwards.
// The supplier is not asked again while the last check is under a minute old (the page shows that
// check), and at most 12 times in 10 minutes per booking: a page that keeps reloading costs the
// supplier nothing.
export async function prepareReview(ctx: BookingContext, bookingId: string, deps: Deps = {}): Promise<ReviewOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  if (booking.status !== "DRAFT") return { kind: "not_draft", booking };
  const rooms = await roomsOf(booking);
  if (!roomsMatchBooking(booking, rooms)) throw new BookingUnavailable("This booking cannot be checked as it is. Search again for current prices.");
  if (rooms.length > 1 && !multiRoomAllowed()) throw new BookingUnavailable(SEVERAL_ROOMS_UNAVAILABLE);
  const checkedAgoMs = booking.bookToken && booking.priceCheckedAt ? now.getTime() - booking.priceCheckedAt.getTime() : null;
  const lastCheck: ReviewOutcome = { kind: "ready", booking, priceChanged: booking.previousTotalMinor !== null };
  if (checkedAgoMs !== null && checkedAgoMs >= 0 && checkedAgoMs < PRICE_CHECK_FRESH_MS) return lastCheck;
  if (!(await hitRateLimit(`review:${booking.id}`, PRICE_CHECK_LIMIT.limit, PRICE_CHECK_LIMIT.windowMs)).allowed) {
    // Too many checks: the last one is shown while it is still good enough to book with.
    if (checkedAgoMs !== null && checkedAgoMs >= 0 && checkedAgoMs <= PRICE_CHECK_VALID_MS) return lastCheck;
    throw new BookingUnavailable("The price was checked too many times in a short while. Wait a few minutes, then try again.");
  }
  let result;
  try {
    result = await supplierOf(deps).priceCheck(
      {
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        rateId: booking.rateId,
        token: booking.priceCheckToken,
        occupancies: rooms.map((room) => ({ adults: room.adults, childAges: room.childAges })),
      },
      ctx.supplierContext,
    );
  } catch (error) {
    if (error instanceof SupplierError) throw new BookingUnavailable("The price could not be checked right now. Try again in a few minutes.");
    throw error;
  }
  if (result.status === "sold_out" || result.price.total.currency !== booking.currency) return { kind: "sold_out", booking };
  // A price for every room, adding up to the whole price; anything else is never used.
  const roomPrices = result.roomPrices;
  if (roomPrices.length !== rooms.length || !pricesAddUp(roomPrices, result.price.total)) {
    console.error(`price check rooms do not add up: booking ${booking.reference}`);
    throw new BookingUnavailable("The price could not be checked right now. Try again in a few minutes.");
  }
  const changed = result.price.total.minor !== booking.totalMinor;
  // The booking and its rooms get the new price together, or not at all.
  const written = await db.$transaction(async (tx) => {
    const draft = await tx.booking.updateMany({
      where: { id: booking.id, status: "DRAFT" },
      data: {
        totalMinor: result.price.total.minor,
        price: result.price as unknown as Prisma.InputJsonValue,
        bookToken: result.bookToken,
        priceCheckedAt: now,
        previousTotalMinor: changed ? booking.totalMinor : booking.previousTotalMinor,
        // A quoted client price stays as it is: its markup follows the checked net.
        ...(booking.sellMinor !== null ? quotedMarkup(booking.sellMinor, result.price.total.minor) : {}),
      },
    });
    if (draft.count === 0) return 0;
    for (const [index, price] of roomPrices.entries()) {
      await tx.bookingRoom.update({ where: { bookingId_index: { bookingId: booking.id, index } }, data: { totalMinor: price.total.minor, price: price as unknown as Prisma.InputJsonValue } });
    }
    return draft.count;
  });
  const updated = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
  if (written === 0) return { kind: "not_draft", booking: updated };
  return { kind: "ready", booking: updated, priceChanged: changed || updated.previousTotalMinor !== null };
}

export type BookOutcome =
  | { kind: "confirmed" | "pending" | "failed" | "already"; bookingId: string }
  | { kind: "insufficient"; shortfallMinor: number }
  | { kind: "review_again"; message: string };

function holdKey(id: string, what: "hold" | "capture" | "release" | "refund"): string {
  return `booking:${id}:${what}`;
}

// One email per booking change, sent by the job queue; queued with the change itself. An event
// that can happen more than once for a booking (a cancellation put back) names the time too.
export async function queueEmail(tx: Prisma.TransactionClient, bookingId: string, event: BookingEmailEvent, occurrence?: Date): Promise<void> {
  await enqueue("email.booking", { bookingId, event }, { dedupeKey: `email.booking:${bookingId}:${event}${occurrence ? `:${occurrence.toISOString()}` : ""}` }, tx);
}

// Every check gets its own job (a unique key), so none is ever skipped as a repeat.
export async function scheduleReconcile(bookingId: string, at: Date, client?: Prisma.TransactionClient): Promise<void> {
  await enqueue("booking.reconcile", { bookingId }, { runAt: at, dedupeKey: `booking.reconcile:${bookingId}:${randomUUID()}` }, client);
}

// Inside book()'s hold transaction: the booking row is locked, and it is still exactly what book()
// read (the same book token and total, the same rooms adding up to that total). A price check
// that committed in between would otherwise be booked with the old token and held at the old
// total; it now holds nothing and sends nothing, and the agent reviews the new price.
async function lockBookingAsRead(tx: Prisma.TransactionClient, read: Booking, readRooms: BookingRoom[]): Promise<void> {
  const [current] = await tx.$queryRaw<{ status: BookingStatus; bookToken: string | null; totalMinor: number }[]>`
    SELECT "status", "bookToken", "totalMinor" FROM "Booking" WHERE "id" = ${read.id} AND "agencyId" = ${read.agencyId} FOR UPDATE`;
  if (!current || current.status !== "DRAFT") throw new BookingStateConflict();
  if (current.bookToken !== read.bookToken || current.totalMinor !== read.totalMinor) throw new BookingChangedSinceRead();
  const rooms = await tx.bookingRoom.findMany({ where: { bookingId: read.id }, select: { totalMinor: true }, orderBy: { index: "asc" } });
  const sum = rooms.reduce((n, room) => n + room.totalMinor, 0);
  if (rooms.length !== readRooms.length || rooms.some((room, i) => room.totalMinor !== readRooms[i]!.totalMinor) || sum !== read.totalMinor) {
    throw new BookingChangedSinceRead();
  }
}

// Screen 11's one button: "Book and pay USD … from balance".
export async function book(
  ctx: BookingContext,
  bookingId: string,
  confirm: { acceptedTerms: boolean; expectedTotalMinor: number },
  deps: Deps = {},
): Promise<BookOutcome> {
  const now = deps.now ?? new Date();
  // Which supplier, before anything is held: a wrong setting stops here with nothing written.
  const supplier = supplierOf(deps);
  const booking = await ownBooking(ctx.agencyId, bookingId);
  if (booking.status !== "DRAFT") return { kind: "already", bookingId: booking.id };
  if (!confirm.acceptedTerms) return { kind: "review_again", message: "Accept the terms and conditions to book." };
  if (!booking.bookToken || !booking.priceCheckedAt || now.getTime() - booking.priceCheckedAt.getTime() > PRICE_CHECK_VALID_MS) {
    return { kind: "review_again", message: "The price check is too old. Review the price again before booking." };
  }
  // The total the agent saw must still be the checked total (the browser's number is only compared).
  if (confirm.expectedTotalMinor !== booking.totalMinor) {
    return { kind: "review_again", message: "The price changed. Review the new price before booking." };
  }
  // The rooms sent are the rooms price-checked (the same rows): every one of them, adding up to
  // the total about to be held. Anything else holds nothing and sends nothing.
  const rooms = await roomsOf(booking);
  if (!roomsMatchBooking(booking, rooms)) return { kind: "review_again", message: "This booking's rooms do not match its price. Review the price again before booking." };
  if (rooms.length > 1 && !multiRoomAllowed()) return { kind: "review_again", message: SEVERAL_ROOMS_UNAVAILABLE };

  // One transaction: the hold, the move to PENDING_CONFIRMATION and a safety-net reconcile job
  // are written together or not at all. A crash at any point after this (even during the
  // supplier call) leaves a pending booking that the job will finish. Never an orphan hold.
  let holdId: string;
  try {
    holdId = await withLedgerTransaction(async (tx) => {
      await lockBookingAsRead(tx, booking, rooms);
      await claimQuoteStay(tx, booking.id);
      const hold = await placeHoldInTx(tx, { agencyId: booking.agencyId, amountCents: booking.totalMinor, bookingRef: booking.reference, idempotencyKey: holdKey(booking.id, "hold") });
      await transition(tx, {
        bookingId: booking.id,
        from: "DRAFT",
        to: "PENDING_CONFIRMATION",
        actorUserId: ctx.userId,
        reason: "Agent booked",
        data: { holdId: hold.holdId, chargedMinor: booking.totalMinor, ...agentOf(ctx.supplierContext) },
      });
      await scheduleReconcile(booking.id, new Date(now.getTime() + SAFETY_NET_MS), tx);
      return hold.holdId;
    });
  } catch (error) {
    // Another click got here first: it books. Nothing of this attempt was written.
    if (error instanceof BookingStateConflict) return { kind: "already", bookingId: booking.id };
    if (error instanceof BookingChangedSinceRead) return { kind: "review_again", message: "The price changed. Review the new price before booking." };
    if (error instanceof QuoteStayAlreadyBooked || error instanceof QuoteStayChanged) return { kind: "review_again", message: error.message };
    if (error instanceof InsufficientFunds) {
      const { balanceCents } = await getBalance(booking.agencyId);
      return { kind: "insufficient", shortfallMinor: Math.max(0, booking.totalMinor - balanceCents) };
    }
    throw error;
  }

  const [countryCode = "", number = ""] = booking.leadPhone.replace(/^\+/, "").split(" ");
  let result;
  try {
    result = await supplier.book(
      {
        bookToken: booking.bookToken,
        affiliateReferenceId: booking.reference,
        lead: { givenName: booking.leadGivenName, familyName: booking.leadFamilyName, email: booking.leadEmail, phone: { countryCode, number } },
        rooms: rooms.map((room) => ({ givenName: room.givenName, familyName: room.familyName })),
        ...(booking.specialRequest ? { specialRequest: booking.specialRequest } : {}),
      },
      ctx.supplierContext,
    );
  } catch (error) {
    if (definiteNo(error)) {
      await failBooking(booking.id, holdId, ctx.userId, `Supplier refused the booking: ${error.message}`.slice(0, 200));
      return { kind: "failed", bookingId: booking.id };
    }
    // No clear answer: the booking may exist. The hold stays; the reconcile job (already
    // queued, plus one sooner) finds out by affiliate reference. Never book again.
    console.error(`booking outcome unknown: ${error instanceof Error ? error.name : "Error"}`);
    await scheduleReconcile(booking.id, new Date(now.getTime() + RECONCILE_DELAY_MS));
    return { kind: "pending", bookingId: booking.id };
  }
  // The supplier took the booking. That alone is not "confirmed": the rooms' own status says so.
  // Its itinerary and links are kept at once (the checks then read this itinerary, and never
  // take "not found yet" for "no booking"), then the status is read. Booked: confirmed and
  // charged. Not readable yet, or a room still pending: the booking waits, the money stays held,
  // and a check follows shortly. Anything else needs an admin.
  try {
    await db.booking.updateMany({
      where: { id: booking.id, status: "PENDING_CONFIRMATION" },
      data: { supplierItineraryId: result.itineraryId, supplierLinks: result.links as Prisma.InputJsonValue },
    });
    let itinerary: RetrievedItinerary | null = null;
    try {
      itinerary = result.links.retrieve
        ? await supplier.retrieve(result.links, ctx.supplierContext)
        : await supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, ctx.supplierContext);
    } catch (error) {
      if (!(error instanceof SupplierError)) throw error;
    }
    const settled = itinerary ? await settlePending(booking, holdId, itinerary, result.links, ctx.userId, "Supplier confirmed the booking", deps) : "wait";
    if (settled === "confirmed") return { kind: "confirmed", bookingId: booking.id };
    if (settled === "failed") return { kind: "failed", bookingId: booking.id };
    await scheduleReconcile(booking.id, new Date(now.getTime() + QUICK_RECHECK_MS));
  } catch (error) {
    // The supplier said yes but our own write failed: the queued job confirms it from the
    // supplier's side (capture is idempotent).
    console.error(`booking confirm write failed: ${error instanceof Error ? error.name : "Error"}`);
  }
  return { kind: "pending", bookingId: booking.id };
}

// A booking waiting for confirmation, with the supplier's own view of it in hand. Confirmed (the
// hold captured) only when the supplier has exactly our rooms and every one is "booked". One
// room that the supplier shows cancelled is no booking: failed, the hold released (as before).
// A room still pending: wait. Anything else (a room missing, cancelled among several, a status
// we do not know, no rooms at all): an admin is told, the money stays held, the checks go on.
// The hold is never captured in those cases.
async function settlePending(
  booking: Booking,
  holdId: string,
  found: RetrievedItinerary,
  links: SupplierLinks,
  actorUserId: string | null,
  confirmedReason: string,
  deps: Deps,
): Promise<"confirmed" | "failed" | "wait"> {
  const rooms = await roomsOf(booking);
  const oneRoom = rooms.length <= 1;
  const sameRooms = found.rooms.length === Math.max(rooms.length, 1);
  if (sameRooms && found.rooms.every((room) => room.status === "booked")) {
    const theirs = oneRoom ? found.rooms[0] : undefined;
    await confirmBooking(
      booking.id,
      holdId,
      { itineraryId: found.itineraryId, links: { ...links, ...(theirs?.cancelLink ? { cancel: theirs.cancelLink } : {}) }, roomId: theirs?.id ?? null, hotelConfirmationId: theirs?.hotelConfirmationId ?? null },
      actorUserId,
      confirmedReason,
    );
    await fillRoomsFromSupplier(booking.id, deps, found);
    return "confirmed";
  }
  if (oneRoom && sameRooms && found.rooms[0]?.status === "cancelled") {
    await failBooking(booking.id, holdId, actorUserId, "Supplier shows the booking as cancelled");
    return "failed";
  }
  const wrong = !sameRooms || found.rooms.some((room) => room.status !== "booked" && room.status !== "pending");
  const why = oneRoom ? "The supplier does not show this booking as booked" : "Some rooms are missing or cancelled at the supplier";
  if (wrong && (await db.$transaction((tx) => flagForAdmin(tx, booking.id, why)))) {
    console.error(`booking ${booking.reference}: not booked at the supplier as expected, needs an admin`);
  }
  return "wait";
}

function sameName(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// After a confirmation: each room's supplier room id, hotel confirmation and cancel link, from
// one retrieve (or the itinerary the caller already has). Matched to our rooms by order and
// checked against the room's main guest (TR5). Another number of rooms, or a name that differs,
// flags the booking for an admin and stores nothing for those rooms. One room here and one at
// the supplier cannot be in the wrong order, so it is filled without the name check (the
// supplier may write a name its own way: an accent added, an apostrophe dropped). Best effort:
// it never throws (the booking is confirmed either way), and a room already filled is never changed.
export async function fillRoomsFromSupplier(bookingId: string, deps: Deps = {}, known?: RetrievedItinerary): Promise<void> {
  try {
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.status !== "CONFIRMED") return;
    const rooms = await roomsOf(booking);
    const unfilled = rooms.filter((room) => room.supplierRoomId === null);
    if (unfilled.length === 0) return;
    const itinerary = known ?? (await supplierView(booking, supplierOf(deps)));
    if (!itinerary) return; // not found yet: the safety-net job tries again
    const sameCount = itinerary.rooms.length === rooms.length;
    const oneRoom = sameCount && rooms.length === 1;
    const matched = sameCount
      ? unfilled.filter((room) => {
          const theirs = itinerary.rooms[room.index];
          if (theirs === undefined) return false;
          return oneRoom || (sameName(theirs.givenName, room.givenName) && sameName(theirs.familyName, room.familyName));
        })
      : [];
    const mismatch = matched.length < unfilled.length;
    await db.$transaction(async (tx) => {
      for (const room of matched) {
        const theirs = itinerary.rooms[room.index]!;
        await tx.bookingRoom.updateMany({
          where: { id: room.id, supplierRoomId: null },
          data: { supplierRoomId: theirs.id, hotelConfirmationId: theirs.hotelConfirmationId, cancelLink: theirs.cancelLink },
        });
      }
      if (mismatch) await flagForAdmin(tx, booking.id, "Rooms at the supplier did not match the booking's rooms");
    });
    if (mismatch) console.error(`booking ${booking.reference}: the supplier's rooms do not match ours, needs an admin`);
  } catch (error) {
    console.error(`booking rooms fill failed: ${error instanceof Error ? error.name : "Error"}`);
  }
}

async function confirmBooking(
  bookingId: string,
  holdId: string,
  supplier: { itineraryId: string; links: SupplierLinks; roomId?: string | null; hotelConfirmationId?: string | null },
  actorUserId: string | null,
  reason: string,
): Promise<void> {
  // Capture first (idempotent): if anything fails after it, reconcile captures again (a no-op)
  // and finishes the move.
  await captureHold(holdId, holdKey(bookingId, "capture"));
  await db.$transaction(async (tx) => {
    await lockQuoteOfBooking(tx, bookingId);
    await transition(tx, {
      bookingId,
      from: "PENDING_CONFIRMATION",
      to: "CONFIRMED",
      actorUserId,
      reason,
      data: {
        supplierItineraryId: supplier.itineraryId,
        supplierLinks: supplier.links as Prisma.InputJsonValue,
        supplierRoomId: supplier.roomId ?? null,
        hotelConfirmationId: supplier.hotelConfirmationId ?? null,
        confirmedAt: new Date(),
        bookToken: null,
      },
    });
    // Plan 5d: from a quote, the quote is booked once all its picked destinations are.
    await syncQuoteOfBooking(tx, bookingId);
    await queueEmail(tx, bookingId, "confirmed");
    // Email #19, its own job (a failure there never repeats the confirmation email).
    const charged = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { agencyId: true } });
    await enqueue("email.low-balance", { agencyId: charged.agencyId }, { dedupeKey: `email.low-balance:${bookingId}` }, tx);
  });
}

// `recheckAt`: later looks at the supplier for a booking failed because it was not found there.
async function failBooking(bookingId: string, holdId: string, actorUserId: string | null, reason: string, recheckAt: Date[] = []): Promise<void> {
  await releaseHold(holdId, holdKey(bookingId, "release"));
  await db.$transaction(async (tx) => {
    await transition(tx, { bookingId, from: "PENDING_CONFIRMATION", to: "FAILED", actorUserId, reason, data: { failureReason: reason, bookToken: null } });
    await queueEmail(tx, bookingId, "failed");
    for (const at of recheckAt) await scheduleReconcile(bookingId, at, tx);
  });
}

// The supplier's view of the booking: through its retrieve link when we have one, otherwise
// by our affiliate reference (a booking confirmed by reconciliation has no retrieve link). Sent
// with the agent's IP and browser as kept on the booking.
export async function supplierView(booking: Booking, supplier: Supplier): Promise<RetrievedItinerary | null> {
  const links = (booking.supplierLinks ?? {}) as SupplierLinks;
  const context = supplierContextOf(booking);
  if (links.retrieve) return supplier.retrieve(links, context);
  return supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, context);
}

// The same for a booking still waiting for confirmation: when its retrieve link is refused (an
// itinerary may not be readable there for a short while), it is looked up by our reference.
async function pendingView(booking: Booking, supplier: Supplier): Promise<RetrievedItinerary | null> {
  try {
    return await supplierView(booking, supplier);
  } catch (error) {
    const links = (booking.supplierLinks ?? {}) as SupplierLinks;
    if (!links.retrieve || !(error instanceof SupplierRequestRejected)) throw error;
    return supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, supplierContextOf(booking));
  }
}

// The background job for bookings without a clear supplier answer (and cancellations).
export async function reconcile(bookingId: string, deps: Deps = {}): Promise<"confirmed" | "failed" | "cancelled" | "restored" | "retry" | "nothing"> {
  const now = deps.now ?? new Date();
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return "nothing";
  const supplier = supplierOf(deps);
  const context = supplierContextOf(booking);
  const attempt = booking.reconcileAttempts + 1;
  // Looks again later, and never stops: a few minutes apart at first, then (an admin is told,
  // once) every hour for 7 days, then every 6 hours. The count and the next job are written
  // together, only while the booking is still in the status this check read (a change of status
  // starts the count again and brings its own job). One job at a time: when another check of
  // this booking is already queued inside the wait, that one carries on and none is added.
  const retry = async (delayMs: number, data: { lastNotFoundAt?: Date } = {}) => {
    const wait = attempt < FAST_RECONCILE_ATTEMPTS ? delayMs : attempt < FAST_RECONCILE_ATTEMPTS + HOURLY_RECONCILE_ATTEMPTS ? HOURLY_RECONCILE_MS : SLOWEST_RECONCILE_MS;
    const next = new Date(now.getTime() + wait);
    const slowsDown = attempt === FAST_RECONCILE_ATTEMPTS;
    await db.$transaction(async (tx) => {
      const counted = await tx.booking.updateMany({ where: { id: booking.id, status: booking.status }, data: { ...data, reconcileAttempts: attempt } });
      if (counted.count === 0) return;
      if (slowsDown) await flagForAdmin(tx, booking.id, "The supplier gave no clear answer after many tries: the check goes on every hour");
      const queued = await tx.job.findFirst({
        where: { kind: "booking.reconcile", status: "QUEUED", runAt: { lte: next }, payload: { path: ["bookingId"], equals: booking.id } },
        select: { id: true },
      });
      if (!queued) await scheduleReconcile(booking.id, next, tx);
    });
    if (slowsDown) console.error(`booking ${booking.reference}: no clear answer from the supplier after ${attempt} checks, needs an admin; checking every hour from now`);
    return "retry" as const;
  };

  if (booking.status === "PENDING_CONFIRMATION" && booking.holdId) {
    // A booking the supplier took (it gave us an itinerary) is usually readable there within a
    // minute or two: its first looks come quickly (30 seconds, then 1, 2 and 4 minutes).
    const again = booking.supplierItineraryId && attempt <= QUICK_RECHECKS ? QUICK_RECHECK_MS * 2 ** (attempt - 1) : RECONCILE_DELAY_MS * 2;
    let found;
    try {
      found = await pendingView(booking, supplier);
    } catch (error) {
      if (error instanceof SupplierError) return retry(again);
      throw error;
    }
    if (found) {
      const rooms = await db.bookingRoom.count({ where: { bookingId: booking.id } });
      const settled = await settlePending(
        booking,
        booking.holdId,
        found,
        (booking.supplierLinks ?? {}) as SupplierLinks,
        null,
        rooms > 1 ? `Reconciled: supplier has all ${rooms} rooms` : "Reconciled: supplier has the booking",
        deps,
      );
      return settled === "wait" ? retry(again) : settled;
    }
    // The supplier took this booking (it gave us an itinerary): "not found" is then never "no
    // booking", only "not readable yet". It stays pending, and after many tries an admin looks.
    if (booking.supplierItineraryId) return retry(again);
    if (booking.lastNotFoundAt && now.getTime() - booking.lastNotFoundAt.getTime() >= NOT_FOUND_CONFIRM_MS) {
      await failBooking(booking.id, booking.holdId, null, NOT_FOUND_REASON, LATE_NOT_FOUND_CHECKS_MS.map((ms) => new Date(now.getTime() + ms)));
      return "failed";
    }
    return retry(NOT_FOUND_CONFIRM_MS, booking.lastNotFoundAt ? {} : { lastNotFoundAt: now });
  }

  if (booking.status === "CANCEL_PENDING") {
    let itinerary;
    try {
      itinerary = await supplierView(booking, supplier);
    } catch (error) {
      if (error instanceof SupplierError) return retry(RECONCILE_DELAY_MS * 2);
      throw error;
    }
    // Rooms the supplier shows as cancelled are cancelled here too, each once.
    let rooms = await roomsOf(booking);
    if (rooms.length === 0) {
      // No room rows (every booking got one when plan 10 shipped): nothing here can say which
      // rooms the supplier cancelled, so nothing is refunded automatically; an admin finishes it.
      if (await db.$transaction((tx) => flagForAdmin(tx, booking.id, "Cancelling without room rows: an admin finishes the cancellation"))) {
        console.error(`booking ${booking.reference}: cancelling without room rows, needs an admin`);
      }
      return retry(RECONCILE_DELAY_MS * 2);
    }
    if (itinerary) {
      for (const room of rooms) {
        if (room.status !== "ACTIVE" || supplierRoomFor(booking, rooms, room, itinerary)?.status !== "cancelled") continue;
        await markRoomCancelled(booking, room, null, `Reconciled: room ${room.index + 1} of ${rooms.length} cancelled at the supplier`);
      }
      rooms = await roomsOf(booking);
    }
    const finish = async () => {
      await finishCancel(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), null, "Reconciled: supplier cancelled the booking");
      return "cancelled" as const;
    };
    const next = rooms.find((room) => room.status === "ACTIVE");
    if (!next) return finish();
    if (!itinerary) return retry(RECONCILE_DELAY_MS * 2);
    // The cancel stopped at an unclear answer before this room: the rooms not sent yet are sent
    // now, in room order, each once. The supplier charges by the moment it gets each cancel, so
    // the charge is worked out again for this moment first (it only ever goes up).
    if (next.cancelRequestedAt === null) {
      await raiseCancelCharge(booking, rooms, now);
      const sent = await sendRoomCancels(booking, supplier, context, null, now);
      if (sent === "done") return finish();
      if (sent === "restored") return "restored";
      return retry(RECONCILE_DELAY_MS * 2);
    }
    // Sent and still booked: a cancellation may take a while at the supplier. After a good while
    // it did not go through: a booking with nothing cancelled is put back (the agent and an admin
    // are told, and the supplier is watched for a day in case it goes through late); one with
    // some rooms cancelled can never be put back (nor refunded for a room the supplier kept),
    // so an admin finishes it.
    const theirs = supplierRoomFor(booking, rooms, next, itinerary);
    if (theirs?.status === "booked" && now.getTime() - next.cancelRequestedAt.getTime() >= CANCEL_RESTORE_AFTER_MS) {
      if (rooms.every((room) => room.status === "ACTIVE")) {
        await db.$transaction((tx) => restoreConfirmed(tx, booking.id, null, "Reconciled: the cancellation did not go through", now));
        return "restored";
      }
      const label = `Room ${next.index + 1} of ${rooms.length}`;
      if (await db.$transaction((tx) => flagForAdmin(tx, booking.id, `${label} was not cancelled at the supplier while other rooms were`))) {
        console.error(`booking ${booking.reference}: a room was not cancelled at the supplier while others were, needs an admin`);
      }
    }
    return retry(RECONCILE_DELAY_MS * 2);
  }

  if (booking.status === "CONFIRMED") {
    // A cancellation was put back not long ago: did the supplier cancel after all?
    if (booking.cancelRestoredAt && now.getTime() - booking.cancelRestoredAt.getTime() <= RESTORE_WATCH_MS + HOUR_MS) {
      let itinerary;
      try {
        itinerary = await supplierView(booking, supplier);
      } catch (error) {
        if (error instanceof SupplierError) return "nothing"; // the next look of the watch tries again
        throw error;
      }
      return itinerary ? finishLateCancel(booking, itinerary, now) : "nothing";
    }
    // Confirmed, but the retrieve after booking failed: the safety-net job fills the rooms now.
    if (!booking.needsAttention) await fillRoomsFromSupplier(booking.id, deps);
    return "nothing";
  }

  // Failed because the supplier did not have it: the late looks. An itinerary that turns up now
  // is a room booked at the supplier that the agency was not charged for. Nothing is charged
  // here; an admin is told at once (flag and email) and settles it by hand.
  if (booking.status === "FAILED" && booking.failureReason === NOT_FOUND_REASON) {
    let found;
    try {
      found = await supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, context);
    } catch (error) {
      if (!(error instanceof SupplierError)) throw error;
      // The supplier cannot be asked now: once more in an hour, for two days after the failure.
      if (booking.lastNotFoundAt && now.getTime() - booking.lastNotFoundAt.getTime() < LATE_NOT_FOUND_GIVE_UP_MS) await scheduleReconcile(booking.id, new Date(now.getTime() + HOUR_MS));
      return "nothing";
    }
    if (found && (found.rooms.length === 0 || found.rooms.some((room) => room.status !== "cancelled"))) {
      const fresh = await db.$transaction(async (tx) => {
        const flagged = await flagForAdmin(tx, booking.id, "Marked not confirmed and the money returned, but the supplier has this booking: the room is booked there and the agency was not charged");
        if (flagged) await queueEmail(tx, booking.id, "found_after_failed");
        return flagged;
      });
      if (fresh) console.error(`booking ${booking.reference}: FAILED here but booked at the supplier, the agency was not charged, needs an admin now`);
    }
    return "nothing";
  }
  return "nothing";
}

// The background check of a booking failed for good (its job ran out of tries on an error of our
// own, not the supplier's): an admin is told. The sweeper queues a new check, so it goes on.
export async function flagReconcileFailed(bookingId: string): Promise<void> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true, reference: true, status: true } });
  if (!booking || (booking.status !== "PENDING_CONFIRMATION" && booking.status !== "CANCEL_PENDING")) return;
  if (await db.$transaction((tx) => flagForAdmin(tx, booking.id, "The background check of this booking failed: an admin looks at it"))) {
    console.error(`booking ${booking.reference}: its background check failed, needs an admin`);
  }
}

// A booking put back to CONFIRMED after a cancellation the supplier did not confirm, and the
// supplier now shows it cancelled: the cancellation went through late. Every room cancelled
// there: it is finished as the agent asked, with the charge quoted then (one refund, the
// "cancelled" email). Only some rooms: nothing can be worked out here, an admin finishes it.
async function finishLateCancel(booking: Booking, itinerary: RetrievedItinerary, now: Date): Promise<"cancelled" | "nothing"> {
  const rooms = await roomsOf(booking);
  const active = rooms.filter((room) => room.status === "ACTIVE");
  const cancelledThere = active.filter((room) => supplierRoomFor(booking, rooms, room, itinerary)?.status === "cancelled");
  if (cancelledThere.length === 0) return "nothing";
  if (cancelledThere.length < active.length || active.length < rooms.length || booking.cancelRestoredChargeMinor === null) {
    if (await db.$transaction((tx) => flagForAdmin(tx, booking.id, "Rooms were cancelled at the supplier after the cancellation was put back: an admin finishes it"))) {
      console.error(`booking ${booking.reference}: rooms cancelled at the supplier after the cancellation was put back, needs an admin`);
    }
    return "nothing";
  }
  try {
    await db.$transaction(async (tx) => {
      await transition(tx, {
        bookingId: booking.id,
        from: "CONFIRMED",
        to: "CANCEL_PENDING",
        actorUserId: null,
        reason: "Reconciled: the supplier cancelled the booking after the cancellation was put back",
        data: { cancelChargeMinor: booking.cancelRestoredChargeMinor, cancelRequestedAt: now, cancelRestoredAt: null, cancelRestoredChargeMinor: null },
      });
      await scheduleReconcile(booking.id, new Date(now.getTime() + SAFETY_NET_MS), tx);
    });
  } catch (error) {
    if (error instanceof BookingStateConflict) return "nothing"; // it moved on meanwhile (the agent cancelled again)
    throw error;
  }
  for (const room of active) await markRoomCancelled(booking, room, null, `Reconciled: room ${room.index + 1} of ${rooms.length} cancelled at the supplier`);
  await finishCancel(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), null, "Reconciled: supplier cancelled the booking");
  return "cancelled";
}

// What the agent is told when a cancellation is not done, each with a short code: the page shows
// the server's own sentence for the code it is sent back with (never text taken from a URL).
export const CANCEL_MESSAGES = {
  not_confirmed: "Only a confirmed booking can be cancelled.",
  stay_started: "The stay has started. Contact Apolles support to change it.",
  needs_support: "This cancellation needs Apolles support: the charge cannot be worked out automatically.",
  charge_changed: "The cancellation charge changed. Check the new charge below, then cancel again.",
  try_later: "The booking could not be cancelled right now. Try again in a few minutes.",
  not_online: "This booking cannot be cancelled online. Contact Apolles support.",
  not_online_now: "This booking cannot be cancelled online right now. Contact Apolles support.",
  already: "This booking is already being cancelled.",
  refused: "The hotel did not accept the cancellation. The booking is still confirmed and nothing was refunded. Contact Apolles support.",
  part_refused: "The hotel did not cancel every room. Apolles support will finish the cancellation; the refund follows once every room is cancelled.",
} as const;
export type CancelMessageCode = keyof typeof CANCEL_MESSAGES;

export type CancelQuote = { allowed: true; chargeMinor: number; refundMinor: number } | { allowed: false; reason: string; code: CancelMessageCode };

function paidMinor(booking: Booking): number {
  return booking.chargedMinor ?? booking.totalMinor;
}

// What cancelling now would cost (shown before the agent confirms). Each room is charged on its
// own total from the rate's penalties (plan 10), and the charges are added; the refund is the
// rest of the amount actually charged. The rooms must be exactly what was paid for, all still
// booked: anything else is worked out by Apolles support, never guessed.
export function cancelQuote(booking: Booking, rooms: Pick<BookingRoom, "totalMinor" | "status">[], now: Date): CancelQuote {
  const no = (code: CancelMessageCode) => ({ allowed: false, reason: CANCEL_MESSAGES[code], code }) as const;
  if (booking.status !== "CONFIRMED") return no("not_confirmed");
  const paid = paidMinor(booking);
  const roomsTotal = rooms.reduce((n, room) => n + room.totalMinor, 0);
  const consistent = rooms.length > 0 && rooms.every((room) => room.status === "ACTIVE") && roomsTotal === paid;
  const charge = consistent
    ? cancelChargeForRooms(
        {
          refundable: booking.refundable,
          roomTotalsMinor: rooms.map((room) => room.totalMinor),
          currency: booking.currency,
          checkin: booking.checkin,
          penalties: booking.cancelPenalties as unknown as CancelPenalty[],
          nonrefundableDateRanges: booking.nonrefundableDateRanges as unknown as { start: string; end: string }[],
        },
        now,
      )
    : ({ kind: "unknown" } as const);
  if (charge.kind === "stay_started") return no("stay_started");
  if (charge.kind === "unknown") return no("needs_support");
  const chargeMinor = Math.min(charge.minor, paid);
  return { allowed: true, chargeMinor, refundMinor: paid - chargeMinor };
}

// A cancellation whose remaining rooms are sent later than the agent's click (by the check, after
// an unclear answer): the supplier charges each room by the moment it gets that room's cancel.
// So the charge is worked out again, room by room: a room already sent at the time it was sent,
// a room sent now at this moment. It only ever goes up, never down, and the change is written in
// the booking's trail. A charge that cannot be worked out now (the stay started, nights, a
// percentage that does not divide) keeps the whole amount for now: nothing is refunded
// automatically and an admin works out the refund.
async function raiseCancelCharge(booking: Booking, rooms: BookingRoom[], now: Date): Promise<void> {
  const paid = paidMinor(booking);
  let sum: number | null = 0;
  for (const room of rooms) {
    const charge = cancelChargeAt(
      {
        refundable: booking.refundable,
        totalMinor: room.totalMinor,
        currency: booking.currency,
        checkin: booking.checkin,
        penalties: booking.cancelPenalties as unknown as CancelPenalty[],
        nonrefundableDateRanges: booking.nonrefundableDateRanges as unknown as { start: string; end: string }[],
      },
      room.cancelRequestedAt ?? now,
    );
    if (charge.kind !== "charge") {
      sum = null;
      break;
    }
    sum += charge.minor;
  }
  const consistent = rooms.reduce((n, room) => n + room.totalMinor, 0) === paid;
  const known = sum !== null && consistent && Number.isSafeInteger(sum);
  const charge = known ? Math.min(sum!, paid) : paid;
  const before = booking.cancelChargeMinor ?? 0;
  if (charge <= before) return;
  await db.$transaction(async (tx) => {
    const raised = await tx.booking.updateMany({ where: { id: booking.id, status: "CANCEL_PENDING" }, data: { cancelChargeMinor: charge } });
    if (raised.count === 0) return;
    if (known) {
      await tx.bookingEvent.create({
        data: { bookingId: booking.id, fromStatus: "CANCEL_PENDING", toStatus: "CANCEL_PENDING", actorUserId: null, reason: `The cancellation charge is now ${formatUsd(charge)} (was ${formatUsd(before)}): the remaining rooms are cancelled later than the agent asked` },
      });
    } else {
      await flagForAdmin(tx, booking.id, `The cancellation charge could not be worked out when the remaining rooms were cancelled (it was ${formatUsd(before)}): nothing is refunded automatically, an admin works out the refund`);
    }
  });
  if (!known) console.error(`booking ${booking.reference}: the cancellation charge could not be worked out again, needs an admin`);
}

// Once every room is cancelled at the supplier, and only then: one refund (idempotent key), the
// booking CANCELLED, one email.
async function finishCancel(booking: Booking, actorUserId: string | null, reason: string): Promise<void> {
  // At least one room, and every room cancelled at the supplier. Rooms only ever go from active
  // to cancelled, so this check before the refund holds after it.
  const [roomCount, activeCount] = await Promise.all([
    db.bookingRoom.count({ where: { bookingId: booking.id } }),
    db.bookingRoom.count({ where: { bookingId: booking.id, status: "ACTIVE" } }),
  ]);
  if (roomCount === 0 || activeCount > 0) throw new Error(`booking ${booking.reference}: not every room is cancelled, not finishing the cancellation`);
  const paid = paidMinor(booking);
  const charge = Math.min(booking.cancelChargeMinor ?? paid, paid);
  const refund = paid - charge;
  // The refund is written only now that the supplier confirmed (idempotent key: once).
  if (refund > 0) {
    await credit({ agencyId: booking.agencyId, type: "REFUND", amountCents: refund, reason: `Refund for cancelled booking ${booking.reference}`, idempotencyKey: holdKey(booking.id, "refund"), bookingRef: booking.reference });
  }
  await db.$transaction(async (tx) => {
    await lockQuoteOfBooking(tx, booking.id);
    await transition(tx, { bookingId: booking.id, from: "CANCEL_PENDING", to: "CANCELLED", actorUserId, reason, data: { refundMinor: refund, cancelledAt: new Date() } });
    // Plan 5d: a cancelled booking from a quote reopens the quote, so it can be booked again.
    await syncQuoteOfBooking(tx, booking.id);
    // An admin asked for this cancellation (spec 7a): the agent is told Apolles support cancelled it.
    await queueEmail(tx, booking.id, (await cancelAskedByAdmin(tx, booking.id)) ? "cancelled_by_support" : "cancelled");
  });
}

// Was the latest cancellation of this booking asked for by an admin (cancelled for the agent)?
async function cancelAskedByAdmin(tx: Prisma.TransactionClient, bookingId: string): Promise<boolean> {
  const asked = await tx.bookingEvent.findFirst({
    where: { bookingId, toStatus: "CANCEL_PENDING", fromStatus: "CONFIRMED" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { actor: { select: { role: true } } },
  });
  return asked?.actor?.role === "ADMIN";
}

// Flags a booking for an admin, and says why: a row in the booking's audit trail under its own
// status (the admin page shows it; the email names no reason). The reason is plain English with
// no personal data. One email per booking, as before. A reason already recorded is not written
// again while the booking stays flagged (a check that retries every few minutes would otherwise
// fill the trail); a new reason is. The booking row is locked first, so two flags at once write
// each reason once. True when something new was recorded.
export async function flagForAdmin(tx: Prisma.TransactionClient, bookingId: string, reason: string, actorUserId: string | null = null): Promise<boolean> {
  const [current] = await tx.$queryRaw<{ status: BookingStatus }[]>`SELECT "status" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  if (!current) throw new BookingNotFound();
  const text = reason.slice(0, 300);
  const flagged = await tx.booking.updateMany({ where: { id: bookingId, needsAttention: false }, data: { needsAttention: true } });
  if (flagged.count > 0) await queueEmail(tx, bookingId, "needs_attention");
  else if (await tx.bookingEvent.findFirst({ where: { bookingId, reason: text }, select: { id: true } })) return false;
  await tx.bookingEvent.create({ data: { bookingId, fromStatus: current.status, toStatus: current.status, actorUserId, reason: text } });
  return true;
}

// Back to CONFIRMED when nothing of the booking was cancelled: no charge, and every room's
// cancel may be sent again by a later cancellation. It is never silent: the charge and refund
// the agent was quoted stay in the booking's trail (and on the booking, for the watch below),
// the agent gets an email saying the cancellation did not go through and what to do, an admin is
// told, and the supplier is looked at again for 24 hours in case the cancellation goes through
// late after all (reconcile then finishes it properly).
async function restoreConfirmed(tx: Prisma.TransactionClient, bookingId: string, actorUserId: string | null, reason: string, now: Date): Promise<void> {
  const before = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { cancelChargeMinor: true, chargedMinor: true, totalMinor: true } });
  const paid = before.chargedMinor ?? before.totalMinor;
  const quoted = before.cancelChargeMinor === null ? "" : `. Quoted to the agent: charge ${formatUsd(before.cancelChargeMinor)}, refund ${formatUsd(Math.max(0, paid - before.cancelChargeMinor))}; nothing was charged or refunded`;
  await transition(tx, {
    bookingId,
    from: "CANCEL_PENDING",
    to: "CONFIRMED",
    actorUserId,
    reason: `${reason.slice(0, 180)}${quoted}`,
    data: { cancelChargeMinor: null, cancelRequestedAt: null, cancelRestoredAt: now, cancelRestoredChargeMinor: before.cancelChargeMinor },
  });
  await tx.bookingRoom.updateMany({ where: { bookingId, status: "ACTIVE" }, data: { cancelRequestedAt: null } });
  await flagForAdmin(tx, bookingId, "A cancellation did not go through at the supplier: the booking is confirmed again", actorUserId);
  await queueEmail(tx, bookingId, "cancel_not_done", now);
  for (const ms of RESTORE_CHECKS_MS) await scheduleReconcile(bookingId, new Date(now.getTime() + ms), tx);
}

// Which of the supplier's rooms is this room of ours: by the supplier room id we stored. A
// booking of one room falls back to the booking's own room id, then to the supplier's first
// room (as before plan 10); several rooms without a stored id match by order only when the
// counts agree.
export function supplierRoomFor(booking: Booking, rooms: BookingRoom[], room: BookingRoom, itinerary: RetrievedItinerary): RetrievedItinerary["rooms"][number] | undefined {
  const id = room.supplierRoomId ?? (rooms.length === 1 ? booking.supplierRoomId : null);
  const byId = id ? itinerary.rooms.find((theirs) => theirs.id === id) : undefined;
  if (rooms.length === 1) return byId ?? itinerary.rooms[0];
  if (id) return byId;
  return itinerary.rooms.length === rooms.length ? itinerary.rooms[room.index] : undefined;
}

// A room the supplier cancelled: CANCELLED here too, with a row in its booking's audit trail, in
// one transaction and only while the room is still active (a retry never cancels it twice).
// The booking itself stays CANCEL_PENDING until every room is cancelled.
async function markRoomCancelled(booking: Booking, room: BookingRoom, actorUserId: string | null, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ status: BookingStatus }[]>`SELECT "status" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
    if (!current) throw new BookingNotFound();
    const done = await tx.bookingRoom.updateMany({ where: { id: room.id, bookingId: booking.id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (done.count === 0) return;
    // A booking no longer cancelling (it cannot be, while a room's cancel is out): the room is
    // still recorded as the supplier has it, and an admin looks at the booking.
    if (current.status !== "CANCEL_PENDING") await flagForAdmin(tx, booking.id, "A room was cancelled at the supplier while the booking was not being cancelled");
    await tx.bookingEvent.create({ data: { bookingId: booking.id, fromStatus: current.status, toStatus: current.status, actorUserId, reason: reason.slice(0, 300) } });
  });
}

type RoomCancels = "done" | "unknown" | "stopped" | "restored" | "refused";

// Sends the cancel of every room still booked, in room order, one at a time: a room's cancel
// goes out only once every room before it is cancelled. Each room is claimed just before its
// call, so it is sent once (a retry, a second click or a parallel check finds it claimed and
// stops there). An unclear answer stops here; the check (reconcile) finds out and carries on.
//   done: every room is cancelled. unknown / stopped: left to the check. restored: refused with
//   nothing cancelled, the booking is confirmed again. refused: refused after some rooms were
//   cancelled, flagged for an admin.
async function sendRoomCancels(booking: Booking, supplier: Supplier, context: SupplierContext, actorUserId: string | null, now: Date): Promise<RoomCancels> {
  const rooms = await roomsOf(booking);
  if (rooms.length === 0) return "stopped"; // no rooms is never "every room cancelled"
  for (const room of rooms) {
    if (room.status !== "ACTIVE") continue;
    const label = `Room ${room.index + 1} of ${rooms.length}`;
    if (!room.cancelLink) {
      // Never guessed: an admin cancels it.
      await db.$transaction((tx) => flagForAdmin(tx, booking.id, `${label} has no cancel link: an admin cancels it`));
      console.error(`booking ${booking.reference}: ${label} has no cancel link, needs an admin`);
      return "stopped";
    }
    const claimed = await db.bookingRoom.updateMany({ where: { id: room.id, status: "ACTIVE", cancelRequestedAt: null, booking: { status: "CANCEL_PENDING" } }, data: { cancelRequestedAt: now } });
    if (claimed.count === 0) return "stopped";
    try {
      await supplier.cancelRoom(room.cancelLink, context);
    } catch (error) {
      if (!definiteNo(error)) {
        console.error(`room cancellation outcome unknown: ${error instanceof Error ? error.name : "Error"}`);
        return "unknown";
      }
      const reason = `Supplier refused the cancellation: ${error.message}`.slice(0, 200);
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${booking.id} FOR UPDATE`;
        // Nothing cancelled yet: as with one room, the booking is confirmed again, no money moves.
        if ((await tx.bookingRoom.count({ where: { bookingId: booking.id, status: "CANCELLED" } })) === 0) {
          await restoreConfirmed(tx, booking.id, actorUserId, reason, now);
          return "restored" as const;
        }
        // Some rooms are cancelled: the booking cannot go back, and nothing is refunded for a
        // room the supplier kept. It stays cancelling; an admin finishes it.
        // The refusal is the flag's reason (one row in the audit trail).
        await flagForAdmin(tx, booking.id, `${label}: ${reason}`, actorUserId);
        return "refused" as const;
      });
    }
    await markRoomCancelled(booking, room, actorUserId, `${label} cancelled at the supplier`);
  }
  return "done";
}

export type CancelOutcome = { kind: "cancelled" | "pending" } | { kind: "refused" | "part_refused" | "not_allowed"; message: string; code: CancelMessageCode };
const notDone = (kind: "refused" | "part_refused" | "not_allowed", code: CancelMessageCode): CancelOutcome => ({ kind, message: CANCEL_MESSAGES[code], code });

// Screen 12: the agent cancels the whole booking: every room, one supplier call per room (Rapid
// cancels room by room). Today's charge is fixed when the agent asks, and the refund (charged −
// charge) is written once, only after the supplier confirms every room.
// `reason`: the first line of the booking's trail for this cancellation (an admin cancelling for the
// agent says so, adminCancelForAgent).
export async function cancel(ctx: BookingContext, bookingId: string, confirm: { expectedChargeMinor: number }, deps: Deps = {}, reason = "Agent asked to cancel"): Promise<CancelOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  let rooms = await roomsOf(booking);
  const quote = cancelQuote(booking, rooms, now);
  if (!quote.allowed) return notDone("not_allowed", quote.code);
  if (quote.chargeMinor !== confirm.expectedChargeMinor) return notDone("not_allowed", "charge_changed");
  const supplier = supplierOf(deps);

  // Every room's own cancel link before anything is sent: a booking is never part-cancelled for
  // want of a link, and a link is never guessed.
  const linkMissing = () => rooms.some((room) => room.status === "ACTIVE" && !room.cancelLink);
  let oneRoom: { cancelLink: string; roomId: string | null } | null = null;
  if (linkMissing()) {
    if (rooms.length === 1) {
      // One room (as before plan 10): the booking's own cancel link, else the supplier's first room.
      let cancelLink = (booking.supplierLinks as SupplierLinks | null)?.cancel ?? null;
      let roomId = rooms[0]!.supplierRoomId ?? booking.supplierRoomId;
      if (!cancelLink) {
        let itinerary;
        try {
          itinerary = await supplierView(booking, supplier);
        } catch (error) {
          if (error instanceof SupplierError) return notDone("refused", "try_later");
          throw error;
        }
        const room = itinerary?.rooms[0];
        cancelLink = room?.cancelLink ?? null;
        roomId = room?.id ?? roomId;
        if (!cancelLink) return notDone("not_allowed", "not_online");
      }
      oneRoom = { cancelLink, roomId };
    } else {
      // Several rooms: one retrieve fills every room's link (checked against its main guest).
      await fillRoomsFromSupplier(booking.id, deps);
      rooms = await roomsOf(booking);
      if (linkMissing()) return notDone("not_allowed", "not_online_now");
    }
  }

  // The move to CANCEL_PENDING and a safety-net reconcile job, together: a crash during the
  // supplier calls still ends in a reconciled cancellation (and its refund).
  try {
    await db.$transaction(async (tx) => {
      await transition(tx, {
        bookingId: booking.id,
        from: "CONFIRMED",
        to: "CANCEL_PENDING",
        actorUserId: ctx.userId,
        reason,
        data: {
          cancelChargeMinor: quote.chargeMinor,
          cancelRequestedAt: now,
          // A new cancellation: the watch of an earlier one that was put back ends here.
          cancelRestoredAt: null,
          cancelRestoredChargeMinor: null,
          ...agentOf(ctx.supplierContext),
          ...(oneRoom ? { supplierRoomId: oneRoom.roomId, supplierLinks: { ...((booking.supplierLinks ?? {}) as SupplierLinks), cancel: oneRoom.cancelLink } } : {}),
        },
      });
      // The one room's link, found on the booking or at the supplier, is the room's from now on.
      if (oneRoom) {
        const [room] = rooms;
        await tx.bookingRoom.updateMany({ where: { id: room!.id, cancelLink: null }, data: { cancelLink: oneRoom.cancelLink, supplierRoomId: room!.supplierRoomId ?? oneRoom.roomId } });
      }
      await scheduleReconcile(booking.id, new Date(now.getTime() + SAFETY_NET_MS), tx);
    });
  } catch (error) {
    if (error instanceof BookingStateConflict) return notDone("not_allowed", "already");
    throw error;
  }

  let sent: RoomCancels;
  try {
    sent = await sendRoomCancels(booking, supplier, ctx.supplierContext, ctx.userId, now);
  } catch (error) {
    // A room was cancelled but our write failed: the queued job finds it cancelled and goes on.
    console.error(`cancel room write failed: ${error instanceof Error ? error.name : "Error"}`);
    return { kind: "pending" };
  }
  if (sent === "restored") return notDone("refused", "refused");
  if (sent === "refused") return notDone("part_refused", "part_refused");
  if (sent !== "done") return { kind: "pending" };
  try {
    await finishCancel(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), ctx.userId, "Supplier confirmed the cancellation");
  } catch (error) {
    // The supplier cancelled but our write failed: the queued job finishes it (refund once).
    console.error(`cancel finish write failed: ${error instanceof Error ? error.name : "Error"}`);
    return { kind: "pending" };
  }
  return { kind: "cancelled" };
}

// ---------------------------------------------------------------------------------------------
// Admin actions on one booking (the admin booking page). The callers are server actions that ran
// requireAdmin() (TOTP included) and pass the admin's user id. Each one writes an audit row and a
// row in the booking's trail, in the same transaction as its change, and is safe to repeat: a
// second click finds the work done and changes nothing.

export const ADMIN_NOTE_MAX = 500;

function adminNote(note: string): string {
  const text = note.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (text.length < 3 || text.length > ADMIN_NOTE_MAX) throw new BookingInputInvalid("note");
  return text;
}

async function lockBooking(tx: Prisma.TransactionClient, bookingId: string): Promise<Booking> {
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  if (!row) throw new BookingNotFound();
  return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
}

// Bookings whose supplier side the background check looks at (reconcile above).
const CHECKABLE: readonly BookingStatus[] = ["PENDING_CONFIRMATION", "CANCEL_PENDING", "CONFIRMED", "FAILED"];
const CHECK_NOW_WINDOW_MS = 60_000;

// "Check with the supplier now": the booking's background check is queued to run at once. A check
// already queued to run within the next minute is enough (a double click queues one).
export async function adminCheckWithSupplier(adminId: string, bookingId: string, now: Date = new Date()): Promise<"queued" | "already_queued" | "not_checkable"> {
  return db.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (!CHECKABLE.includes(booking.status)) return "not_checkable";
    const soon = new Date(now.getTime() + CHECK_NOW_WINDOW_MS);
    const queued = await tx.job.findFirst({
      where: { kind: "booking.reconcile", status: "QUEUED", runAt: { lte: soon }, payload: { path: ["bookingId"], equals: booking.id } },
      select: { id: true },
    });
    if (queued) return "already_queued";
    await scheduleReconcile(booking.id, now, tx);
    await audit(adminId, "booking.supplier-check", "Booking", booking.id, undefined, { status: booking.status }, tx);
    return "queued";
  });
}

// "Mark resolved": clears needsAttention; the admin's note goes in the booking's trail.
export async function adminMarkResolved(adminId: string, bookingId: string, note: string): Promise<"resolved" | "not_flagged"> {
  const text = adminNote(note);
  return db.$transaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    const cleared = await tx.booking.updateMany({ where: { id: booking.id, needsAttention: true }, data: { needsAttention: false } });
    if (cleared.count === 0) return "not_flagged";
    await tx.bookingEvent.create({ data: { bookingId: booking.id, fromStatus: booking.status, toStatus: booking.status, actorUserId: adminId, reason: `Resolved by an admin: ${text}`.slice(0, 300) } });
    await audit(adminId, "booking.resolve", "Booking", booking.id, { needsAttention: true }, { needsAttention: false }, tx);
    return "resolved";
  });
}

// What cancelling for the agent would cost now (the confirmation step shows it).
export async function adminCancelQuote(bookingId: string, now: Date = new Date()): Promise<CancelQuote | null> {
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return null;
  return cancelQuote(booking, await roomsOf(booking), now);
}

// "Cancel for the agent": the agent's own cancellation, with the same charge rules, asked by the
// admin (spec 7a). The supplier is called with the agent's IP and browser kept on the booking.
// The trail names the admin; the agent gets the "cancelled by Apolles support" email. The audit
// row is written after the supplier answered (no transaction can wait for the supplier); the
// booking's own changes are each in their transaction, as for the agent.
export async function adminCancelForAgent(adminId: string, bookingId: string, confirm: { expectedChargeMinor: number }, deps: Deps = {}): Promise<CancelOutcome> {
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new BookingNotFound();
  const ctx: BookingContext = { agencyId: booking.agencyId, userId: adminId, supplierContext: supplierContextOf(booking) };
  const outcome = await cancel(ctx, booking.id, confirm, deps, "An admin cancelled the booking for the agent");
  if (outcome.kind !== "not_allowed") {
    await audit(adminId, "booking.cancel-for-agent", "Booking", booking.id, { status: booking.status }, { outcome: outcome.kind, chargeMinor: confirm.expectedChargeMinor });
  }
  return outcome;
}

export type AdminRefundOutcome = { kind: "recorded"; refundMinor: number } | { kind: "already"; refundMinor: number } | { kind: "not_allowed"; message: string };

// "Record refund" for a booking cancelled by the hotel or the supplier: the amount the supplier
// gives back, at most what the agency was charged, credited once through the ledger (the same
// refund key as any cancellation of this booking, so it can never be refunded twice). The
// booking keeps the refund and the charge kept, the trail and the audit say who and how much,
// and the agent is emailed. All in one transaction (booking row, then the agency's wallet).
export async function adminRecordSupplierRefund(adminId: string, bookingId: string, amountMinor: number): Promise<AdminRefundOutcome> {
  return withLedgerTransaction(async (tx) => {
    const booking = await lockBooking(tx, bookingId);
    if (booking.status !== "CANCELLED_BY_SUPPLIER") return { kind: "not_allowed", message: "Only a booking cancelled by the hotel can get a refund here." } as const;
    if (booking.refundMinor !== null) return { kind: "already", refundMinor: booking.refundMinor } as const;
    const paid = paidMinor(booking);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > paid) {
      return { kind: "not_allowed", message: `Enter an amount from USD 0.01 to ${formatUsd(paid)}, the amount charged.` } as const;
    }
    const written = await creditInTx(tx, {
      agencyId: booking.agencyId,
      type: "REFUND",
      amountCents: amountMinor,
      reason: `Refund for booking ${booking.reference}, cancelled by the hotel`,
      actorUserId: adminId,
      idempotencyKey: holdKey(booking.id, "refund"),
      bookingRef: booking.reference,
    });
    if (!written.created) return { kind: "already", refundMinor: Math.abs(written.entry.amountCents) } as const;
    await tx.booking.update({ where: { id: booking.id }, data: { refundMinor: amountMinor, cancelChargeMinor: paid - amountMinor } });
    await tx.bookingEvent.create({
      data: { bookingId: booking.id, fromStatus: booking.status, toStatus: booking.status, actorUserId: adminId, reason: `Refund recorded by an admin: ${formatUsd(amountMinor)} of ${formatUsd(paid)} charged` },
    });
    await audit(adminId, "booking.refund", "Booking", booking.id, { refundMinor: null }, { refundMinor: amountMinor, chargedMinor: paid }, tx);
    await queueEmail(tx, booking.id, "refund_recorded");
    return { kind: "recorded", refundMinor: amountMinor } as const;
  });
}

export type AdminReleaseOutcome = "released" | "already" | "not_allowed";

// "Release the hold and mark failed": a booking still waiting for the supplier, with money held,
// that the admin checked is not booked there. The hold is released (its own idempotent key, as
// when the supplier says no), then the booking moves to FAILED with the admin's note, the flag
// cleared and the audit row, in one transaction; the agent gets the "not confirmed" email. A
// hold the supplier's confirmation captured meanwhile cannot be released: nothing changes.
export async function adminReleaseHold(adminId: string, bookingId: string, note: string): Promise<AdminReleaseOutcome> {
  const text = adminNote(note);
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new BookingNotFound();
  if (booking.status === "FAILED") return "already";
  if (booking.status !== "PENDING_CONFIRMATION" || !booking.holdId) return "not_allowed";
  try {
    await releaseHold(booking.holdId, holdKey(booking.id, "release"));
  } catch (error) {
    if (error instanceof HoldNotOpen) return "not_allowed";
    throw error;
  }
  try {
    await db.$transaction(async (tx) => {
      const reason = "Released by an admin after checking the supplier";
      await transition(tx, {
        bookingId: booking.id,
        from: "PENDING_CONFIRMATION",
        to: "FAILED",
        actorUserId: adminId,
        reason: `An admin released the hold: ${text}`,
        data: { failureReason: reason, bookToken: null, needsAttention: false },
      });
      await audit(adminId, "booking.release-hold", "Booking", booking.id, { status: "PENDING_CONFIRMATION" }, { status: "FAILED", releasedMinor: booking.chargedMinor ?? booking.totalMinor }, tx);
      await queueEmail(tx, booking.id, "failed");
    });
  } catch (error) {
    if (error instanceof BookingStateConflict) return (await db.booking.findUnique({ where: { id: booking.id }, select: { status: true } }))?.status === "FAILED" ? "already" : "not_allowed";
    throw error;
  }
  return "released";
}

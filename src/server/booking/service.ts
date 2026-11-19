import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Booking, BookingRoom, BookingStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { QuoteStayAlreadyBooked, QuoteStayChanged, claimQuoteStay, lockQuoteOfBooking, stayForDraft, syncQuoteOfBooking } from "@/server/quotes/quote-booking";
import { SEVERAL_ROOMS_UNAVAILABLE } from "@/server/search/errors";
import { MAX_ROOMS } from "@/server/search/input";
import { findOffer } from "@/server/search/search";
import { bookingSupplier, multiRoomAllowed } from "@/server/supplier";
import { SupplierAuthError, SupplierError, SupplierRateLimited, SupplierRequestRejected } from "@/server/supplier/expedia/client";
import { SupplierNotSent } from "@/server/supplier/expedia/booking";
import type { BookingSupplier, CancelPenalty, PriceBreakdown, RetrievedItinerary, SupplierAdapter, SupplierContext, SupplierLinks } from "@/server/supplier/types";
import { captureHold, credit, getBalance, placeHoldInTx, releaseHold, withLedgerTransaction } from "@/server/wallet/ledger";
import { InsufficientFunds } from "@/server/wallet/errors";
import { cancelChargeForRooms } from "./cancel-charge";
import type { BookingEmailEvent } from "./emails";
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
const RECONCILE_DELAY_MS = 2 * 60_000;
const SAFETY_NET_MS = 5 * 60_000; // queued with every pending change, before the supplier call
const CANCEL_RESTORE_AFTER_MS = 30 * 60_000; // a cancellation still "booked" this long after the request did not go through
// "Not found" twice, this far apart, means no booking. Rapid says a new itinerary may take a few
// minutes before it can be found, so the gap is generous.
const NOT_FOUND_CONFIRM_MS = 20 * 60_000;

// A definite "no": the supplier refused, or nothing was sent. Anything else is "not known".
function definiteNo(error: unknown): error is SupplierError {
  return error instanceof SupplierRequestRejected || error instanceof SupplierAuthError || error instanceof SupplierRateLimited || error instanceof SupplierNotSent;
}
const MAX_RECONCILE_ATTEMPTS = 48;

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
// with its offset). null: non-refundable, or no charge listed.
// Same as the cancel screen: nights that cannot be refunded, or a date that cannot be read, mean
// no free-cancellation promise at all.
export function freeCancelEnds(offer: { refundable: boolean; cancelPenalties: CancelPenalty[]; nonrefundableDateRanges?: unknown[] }): Date | null {
  if (!offer.refundable || (offer.nonrefundableDateRanges?.length ?? 0) > 0) return null;
  const starts = offer.cancelPenalties.map((p) => Date.parse(p.start));
  if (starts.length === 0 || starts.some((t) => !Number.isFinite(t))) return null;
  return new Date(Math.min(...starts));
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
function roomsOf(booking: Pick<Booking, "id" | "agencyId">): Promise<BookingRoom[]> {
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
  let fromQuote: { quoteId: string; quoteStayId: string; sellMarkup: { markupType: "PERCENT" | "FIXED"; markupValue: number } | null } | null = null;
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
    sellMarkupType: fromQuote?.sellMarkup?.markupType ?? null,
    sellMarkupValue: fromQuote?.sellMarkup?.markupValue ?? null,
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
export async function prepareReview(ctx: BookingContext, bookingId: string, deps: Deps = {}): Promise<ReviewOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  if (booking.status !== "DRAFT") return { kind: "not_draft", booking };
  const rooms = await roomsOf(booking);
  if (!roomsMatchBooking(booking, rooms)) throw new BookingUnavailable("This booking cannot be checked as it is. Search again for current prices.");
  if (rooms.length > 1 && !multiRoomAllowed()) throw new BookingUnavailable(SEVERAL_ROOMS_UNAVAILABLE);
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

// One email per booking change, sent by the job queue; queued with the change itself.
async function queueEmail(tx: Prisma.TransactionClient, bookingId: string, event: BookingEmailEvent): Promise<void> {
  await enqueue("email.booking", { bookingId, event }, { dedupeKey: `email.booking:${bookingId}:${event}` }, tx);
}

// Every check gets its own job (a unique key), so none is ever skipped as a repeat.
async function scheduleReconcile(bookingId: string, at: Date, client?: Prisma.TransactionClient): Promise<void> {
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
        data: { holdId: hold.holdId, chargedMinor: booking.totalMinor },
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
    result = await supplierOf(deps).book(
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
  try {
    await confirmBooking(booking.id, holdId, { itineraryId: result.itineraryId, links: result.links }, ctx.userId, "Supplier confirmed the booking");
  } catch (error) {
    // The supplier said yes but our own write failed: the queued job confirms it from the
    // supplier's side (capture is idempotent).
    console.error(`booking confirm write failed: ${error instanceof Error ? error.name : "Error"}`);
    return { kind: "pending", bookingId: booking.id };
  }
  await fillRoomsFromSupplier(booking.id, deps);
  return { kind: "confirmed", bookingId: booking.id };
}

function sameName(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// After a confirmation: each room's supplier room id, hotel confirmation and cancel link, from
// one retrieve (or the itinerary the caller already has). Matched to our rooms by order and
// checked against the room's main guest (TR5). Another number of rooms, or a name that differs,
// flags the booking for an admin and stores nothing for those rooms. Best effort: it never
// throws (the booking is confirmed either way), and a room already filled is never changed.
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
    const matched = sameCount
      ? unfilled.filter((room) => {
          const theirs = itinerary.rooms[room.index];
          return theirs !== undefined && sameName(theirs.givenName, room.givenName) && sameName(theirs.familyName, room.familyName);
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
      if (mismatch) {
        await tx.booking.update({ where: { id: booking.id }, data: { needsAttention: true } });
        await queueEmail(tx, booking.id, "needs_attention");
      }
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

async function failBooking(bookingId: string, holdId: string, actorUserId: string | null, reason: string): Promise<void> {
  await releaseHold(holdId, holdKey(bookingId, "release"));
  await db.$transaction(async (tx) => {
    await transition(tx, { bookingId, from: "PENDING_CONFIRMATION", to: "FAILED", actorUserId, reason, data: { failureReason: reason, bookToken: null } });
    await queueEmail(tx, bookingId, "failed");
  });
}

// The supplier's view of the booking: through its retrieve link when we have one, otherwise
// by our affiliate reference (a booking confirmed by reconciliation has no retrieve link).
async function supplierView(booking: Booking, supplier: Supplier): Promise<RetrievedItinerary | null> {
  const links = (booking.supplierLinks ?? {}) as SupplierLinks;
  if (links.retrieve) return supplier.retrieve(links, {});
  return supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, {});
}

// The background job for bookings without a clear supplier answer (and cancellations).
export async function reconcile(bookingId: string, deps: Deps = {}): Promise<"confirmed" | "failed" | "cancelled" | "restored" | "retry" | "nothing"> {
  const now = deps.now ?? new Date();
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return "nothing";
  const supplier = supplierOf(deps);
  const attempt = booking.reconcileAttempts + 1;
  const retry = async (delayMs: number, data: Prisma.BookingUpdateInput = {}) => {
    if (attempt >= MAX_RECONCILE_ATTEMPTS) {
      // Gave up: flag it for an admin (the admin bookings list shows it), keep the money as is.
      await db.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: booking.id }, data: { ...data, reconcileAttempts: attempt, needsAttention: true } });
        await queueEmail(tx, booking.id, "needs_attention");
      });
      console.error(`booking ${booking.reference}: reconcile gave up, needs an admin`);
      return "retry" as const;
    }
    await db.booking.update({ where: { id: booking.id }, data: { ...data, reconcileAttempts: attempt } });
    await scheduleReconcile(booking.id, new Date(now.getTime() + delayMs));
    return "retry" as const;
  };

  if (booking.status === "PENDING_CONFIRMATION" && booking.holdId) {
    let found;
    try {
      found = await supplier.findByAffiliateReference({ affiliateReferenceId: booking.reference, email: booking.leadEmail }, {});
    } catch (error) {
      if (error instanceof SupplierError) return retry(RECONCILE_DELAY_MS * 2);
      throw error;
    }
    if (found) {
      const rooms = await roomsOf(booking);
      if (rooms.length > 1) {
        // Several rooms: confirmed only when the supplier has every room booked. A room cancelled,
        // missing or unclear there needs an admin; the booking is never failed while some of its
        // rooms may be booked (the money stays held). A room still pending: look again later.
        if (found.rooms.length === rooms.length && found.rooms.every((r) => r.status === "booked")) {
          await confirmBooking(booking.id, booking.holdId, { itineraryId: found.itineraryId, links: {} }, null, `Reconciled: supplier has all ${rooms.length} rooms`);
          await fillRoomsFromSupplier(booking.id, deps, found);
          return "confirmed";
        }
        const wrong = found.rooms.length !== rooms.length || found.rooms.some((r) => r.status !== "booked" && r.status !== "pending");
        if (wrong && !booking.needsAttention) {
          await db.$transaction(async (tx) => {
            await tx.booking.update({ where: { id: booking.id }, data: { needsAttention: true } });
            await queueEmail(tx, booking.id, "needs_attention");
          });
          console.error(`booking ${booking.reference}: some rooms are not booked at the supplier, needs an admin`);
        }
        return retry(RECONCILE_DELAY_MS * 2);
      }
      const room = found.rooms[0];
      if (room?.status === "cancelled") {
        await failBooking(booking.id, booking.holdId, null, "Supplier shows the booking as cancelled");
        return "failed";
      }
      await confirmBooking(
        booking.id,
        booking.holdId,
        { itineraryId: found.itineraryId, links: { ...(room?.cancelLink ? { cancel: room.cancelLink } : {}) }, roomId: room?.id ?? null, hotelConfirmationId: room?.hotelConfirmationId ?? null },
        null,
        "Reconciled: supplier has the booking",
      );
      await fillRoomsFromSupplier(booking.id, deps, found);
      return "confirmed";
    }
    if (booking.lastNotFoundAt && now.getTime() - booking.lastNotFoundAt.getTime() >= NOT_FOUND_CONFIRM_MS) {
      await failBooking(booking.id, booking.holdId, null, "Reconciled: supplier has no such booking");
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
    // now, in room order, each once.
    if (next.cancelRequestedAt === null) {
      const sent = await sendRoomCancels(booking, supplier, {}, null, now);
      if (sent === "done") return finish();
      if (sent === "restored") return "restored";
      return retry(RECONCILE_DELAY_MS * 2);
    }
    // Sent and still booked: a cancellation may take a while at the supplier. After a good while
    // it did not go through: a booking with nothing cancelled is put back, as before; one with
    // some rooms cancelled can never be put back (nor refunded for a room the supplier kept),
    // so an admin finishes it.
    const theirs = supplierRoomFor(booking, rooms, next, itinerary);
    if (theirs?.status === "booked" && now.getTime() - next.cancelRequestedAt.getTime() >= CANCEL_RESTORE_AFTER_MS) {
      if (rooms.every((room) => room.status === "ACTIVE")) {
        await db.$transaction((tx) => restoreConfirmed(tx, booking.id, null, "Reconciled: the cancellation did not go through"));
        return "restored";
      }
      await db.$transaction((tx) => flagForAdmin(tx, booking.id));
      console.error(`booking ${booking.reference}: a room was not cancelled at the supplier while others were, needs an admin`);
    }
    return retry(RECONCILE_DELAY_MS * 2);
  }

  // Confirmed, but the retrieve after booking failed: the safety-net job fills the rooms now.
  if (booking.status === "CONFIRMED" && !booking.needsAttention) await fillRoomsFromSupplier(booking.id, deps);
  return "nothing";
}

export type CancelQuote = { allowed: true; chargeMinor: number; refundMinor: number } | { allowed: false; reason: string };

function paidMinor(booking: Booking): number {
  return booking.chargedMinor ?? booking.totalMinor;
}

// What cancelling now would cost (shown before the agent confirms). Each room is charged on its
// own total from the rate's penalties (plan 10), and the charges are added; the refund is the
// rest of the amount actually charged. The rooms must be exactly what was paid for, all still
// booked: anything else is worked out by Apolles support, never guessed.
export function cancelQuote(booking: Booking, rooms: Pick<BookingRoom, "totalMinor" | "status">[], now: Date): CancelQuote {
  if (booking.status !== "CONFIRMED") return { allowed: false, reason: "Only a confirmed booking can be cancelled." };
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
  if (charge.kind === "stay_started") return { allowed: false, reason: "The stay has started. Contact Apolles support to change it." };
  if (charge.kind === "unknown") return { allowed: false, reason: "This cancellation needs Apolles support: the charge cannot be worked out automatically." };
  const chargeMinor = Math.min(charge.minor, paid);
  return { allowed: true, chargeMinor, refundMinor: paid - chargeMinor };
}

// Once every room is cancelled at the supplier, and only then: one refund (idempotent key), the
// booking CANCELLED, one email.
async function finishCancel(booking: Booking, actorUserId: string | null, reason: string): Promise<void> {
  // Rooms only ever go from active to cancelled, so this check before the refund holds after it.
  if ((await db.bookingRoom.count({ where: { bookingId: booking.id, status: "ACTIVE" } })) > 0) throw new Error(`booking ${booking.reference}: rooms still booked, not finishing the cancellation`);
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
    await queueEmail(tx, booking.id, "cancelled");
  });
}

async function flagForAdmin(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  const flagged = await tx.booking.updateMany({ where: { id: bookingId, needsAttention: false }, data: { needsAttention: true } });
  if (flagged.count > 0) await queueEmail(tx, bookingId, "needs_attention");
}

// Back to CONFIRMED when nothing of the booking was cancelled: no charge, and every room's
// cancel may be sent again by a later cancellation.
async function restoreConfirmed(tx: Prisma.TransactionClient, bookingId: string, actorUserId: string | null, reason: string): Promise<void> {
  await transition(tx, { bookingId, from: "CANCEL_PENDING", to: "CONFIRMED", actorUserId, reason, data: { cancelChargeMinor: null, cancelRequestedAt: null } });
  await tx.bookingRoom.updateMany({ where: { bookingId, status: "ACTIVE" }, data: { cancelRequestedAt: null } });
}

// Which of the supplier's rooms is this room of ours: by the supplier room id we stored. A
// booking of one room falls back to the booking's own room id, then to the supplier's first
// room (as before plan 10); several rooms without a stored id match by order only when the
// counts agree.
function supplierRoomFor(booking: Booking, rooms: BookingRoom[], room: BookingRoom, itinerary: RetrievedItinerary): RetrievedItinerary["rooms"][number] | undefined {
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
    if (current.status !== "CANCEL_PENDING") await flagForAdmin(tx, booking.id);
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
  for (const room of rooms) {
    if (room.status !== "ACTIVE") continue;
    const label = `Room ${room.index + 1} of ${rooms.length}`;
    if (!room.cancelLink) {
      // Never guessed: an admin cancels it.
      await db.$transaction((tx) => flagForAdmin(tx, booking.id));
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
          await restoreConfirmed(tx, booking.id, actorUserId, reason);
          return "restored" as const;
        }
        // Some rooms are cancelled: the booking cannot go back, and nothing is refunded for a
        // room the supplier kept. It stays cancelling; an admin finishes it.
        await flagForAdmin(tx, booking.id);
        await tx.bookingEvent.create({ data: { bookingId: booking.id, fromStatus: "CANCEL_PENDING", toStatus: "CANCEL_PENDING", actorUserId, reason: `${label}: ${reason}` } });
        return "refused" as const;
      });
    }
    await markRoomCancelled(booking, room, actorUserId, `${label} cancelled at the supplier`);
  }
  return "done";
}

export type CancelOutcome = { kind: "cancelled" | "pending" | "refused" | "part_refused" | "not_allowed"; message?: string };

// Screen 12: the agent cancels the whole booking: every room, one supplier call per room (Rapid
// cancels room by room). Today's charge is fixed when the agent asks, and the refund (charged −
// charge) is written once, only after the supplier confirms every room.
export async function cancel(ctx: BookingContext, bookingId: string, confirm: { expectedChargeMinor: number }, deps: Deps = {}): Promise<CancelOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  let rooms = await roomsOf(booking);
  const quote = cancelQuote(booking, rooms, now);
  if (!quote.allowed) return { kind: "not_allowed", message: quote.reason };
  if (quote.chargeMinor !== confirm.expectedChargeMinor) return { kind: "not_allowed", message: "The cancellation charge changed. Check it again." };
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
          if (error instanceof SupplierError) return { kind: "refused", message: "The booking could not be cancelled right now. Try again in a few minutes." };
          throw error;
        }
        const room = itinerary?.rooms[0];
        cancelLink = room?.cancelLink ?? null;
        roomId = room?.id ?? roomId;
        if (!cancelLink) return { kind: "not_allowed", message: "This booking cannot be cancelled online. Contact Apolles support." };
      }
      oneRoom = { cancelLink, roomId };
    } else {
      // Several rooms: one retrieve fills every room's link (checked against its main guest).
      await fillRoomsFromSupplier(booking.id, deps);
      rooms = await roomsOf(booking);
      if (linkMissing()) return { kind: "not_allowed", message: "This booking cannot be cancelled online right now. Contact Apolles support." };
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
        reason: "Agent asked to cancel",
        data: {
          cancelChargeMinor: quote.chargeMinor,
          cancelRequestedAt: now,
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
    if (error instanceof BookingStateConflict) return { kind: "not_allowed", message: "This booking is already being cancelled." };
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
  if (sent === "restored") return { kind: "refused", message: "The supplier did not accept the cancellation. Contact Apolles support." };
  if (sent === "refused") return { kind: "part_refused", message: "The supplier did not cancel every room. Apolles support will finish the cancellation." };
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

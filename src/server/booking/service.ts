import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Booking, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { findOffer } from "@/server/search/search";
import { bookingSupplier } from "@/server/supplier";
import { SupplierAuthError, SupplierError, SupplierRateLimited, SupplierRequestRejected } from "@/server/supplier/expedia/client";
import { SupplierNotSent } from "@/server/supplier/expedia/booking";
import type { BookingSupplier, CancelPenalty, PriceBreakdown, SupplierAdapter, SupplierContext, SupplierLinks } from "@/server/supplier/types";
import { captureHold, credit, getBalance, placeHold, releaseHold } from "@/server/wallet/ledger";
import { InsufficientFunds } from "@/server/wallet/errors";
import { cancelChargeAt } from "./cancel-charge";
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

export type BookingContext = { agencyId: string; userId: string; supplierContext: SupplierContext };
type Supplier = SupplierAdapter & BookingSupplier;
type Deps = { supplier?: Supplier; now?: Date };

export class BookingInputInvalid extends Error {}
export class BookingNotFound extends Error {}
export class BookingRateExpired extends Error {}
export class BookingUnavailable extends Error {}

const PRICE_CHECK_VALID_MS = 10 * 60_000; // the book button needs a price check this recent
const RECONCILE_DELAY_MS = 2 * 60_000;
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
const guestSchema = z.object({ givenName: name, familyName: name }).strict();

export const draftInputSchema = z
  .object({
    snapshotId: z.string().min(1).max(64),
    propertyId: z.string().min(1).max(64),
    rateId: z.string().min(1).max(128),
    bedGroupId: z.string().min(1).max(128),
    guests: z.array(guestSchema).min(1).max(14),
    leadEmail: z.string().trim().toLowerCase().max(254).email(),
    leadPhone: z.object({ countryCode: z.string().regex(/^\d{1,3}$/), number: z.string().regex(/^\d{4,14}$/) }).strict(),
  })
  .strict();
export type DraftInput = z.infer<typeof draftInputSchema>;

function supplierOf(deps: Deps): Supplier {
  return deps.supplier ?? bookingSupplier();
}

async function ownBooking(agencyId: string, bookingId: string): Promise<Booking> {
  if (typeof bookingId !== "string" || bookingId.length > 64) throw new BookingNotFound();
  const booking = await db.booking.findFirst({ where: { id: bookingId, agencyId } });
  if (!booking) throw new BookingNotFound();
  return booking;
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
  const found = await findOffer(ctx.agencyId, { snapshotId: input.snapshotId, propertyId: input.propertyId, rateId: input.rateId, bedGroupId: input.bedGroupId }, now);
  if (!found) throw new BookingRateExpired("These prices expired. Search again for current prices.");
  const { offer, bedGroup, hotel, query } = found;
  if (input.guests.length !== query.adults + query.childAges.length) {
    throw new BookingInputInvalid("Enter a name for every guest.");
  }
  const lead = input.guests[0]!;
  const data = {
    agencyId: ctx.agencyId,
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
    checkin: query.checkin,
    checkout: query.checkout,
    adults: query.adults,
    childAges: query.childAges,
    leadGivenName: lead.givenName,
    leadFamilyName: lead.familyName,
    leadEmail: input.leadEmail,
    leadPhone: `+${input.leadPhone.countryCode} ${input.leadPhone.number}`,
    guests: input.guests,
    refundable: offer.refundable,
    totalMinor: offer.price.total.minor,
    currency: offer.price.total.currency,
    price: offer.price as unknown as Prisma.InputJsonValue,
    cancelPenalties: offer.cancelPenalties as unknown as Prisma.InputJsonValue,
    nonrefundableDateRanges: offer.nonrefundableDateRanges as unknown as Prisma.InputJsonValue,
    priceCheckToken: bedGroup.priceCheckToken,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const booking = await tx.booking.create({ data: { ...data, reference: newReference() }, select: { id: true } });
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
export async function prepareReview(ctx: BookingContext, bookingId: string, deps: Deps = {}): Promise<ReviewOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  if (booking.status !== "DRAFT") return { kind: "not_draft", booking };
  let result;
  try {
    result = await supplierOf(deps).priceCheck(
      { propertyId: booking.propertyId, roomId: booking.roomId, rateId: booking.rateId, token: booking.priceCheckToken },
      ctx.supplierContext,
    );
  } catch (error) {
    if (error instanceof SupplierError) throw new BookingUnavailable("The price could not be checked right now. Try again in a few minutes.");
    throw error;
  }
  if (result.status === "sold_out") return { kind: "sold_out", booking };
  if (result.price.total.currency !== booking.currency) return { kind: "sold_out", booking };
  const changed = result.price.total.minor !== booking.totalMinor;
  const updated = await db.booking.update({
    where: { id: booking.id },
    data: {
      totalMinor: result.price.total.minor,
      price: result.price as unknown as Prisma.InputJsonValue,
      bookToken: result.bookToken,
      priceCheckedAt: now,
      previousTotalMinor: changed ? booking.totalMinor : booking.previousTotalMinor,
    },
  });
  return { kind: "ready", booking: updated, priceChanged: changed || updated.previousTotalMinor !== null };
}

export type BookOutcome =
  | { kind: "confirmed" | "pending" | "failed" | "already"; bookingId: string }
  | { kind: "insufficient"; shortfallMinor: number }
  | { kind: "review_again"; message: string };

function holdKey(id: string, what: "hold" | "capture" | "release" | "refund"): string {
  return `booking:${id}:${what}`;
}

async function scheduleReconcile(bookingId: string, attempt: number, at: Date): Promise<void> {
  await enqueue("booking.reconcile", { bookingId }, { runAt: at, dedupeKey: `booking.reconcile:${bookingId}:${attempt}` });
}

// Screen 11's one button: "Book and issue voucher".
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

  let holdId: string;
  try {
    ({ holdId } = await placeHold({ agencyId: booking.agencyId, amountCents: booking.totalMinor, bookingRef: booking.reference, idempotencyKey: holdKey(booking.id, "hold") }));
  } catch (error) {
    if (error instanceof InsufficientFunds) {
      const { balanceCents } = await getBalance(booking.agencyId);
      return { kind: "insufficient", shortfallMinor: Math.max(0, booking.totalMinor - balanceCents) };
    }
    throw error;
  }
  try {
    await db.$transaction((tx) =>
      transition(tx, { bookingId: booking.id, from: "DRAFT", to: "PENDING_CONFIRMATION", actorUserId: ctx.userId, reason: "Agent booked", data: { holdId } }),
    );
  } catch (error) {
    // Another click got here first with the same hold (same idempotency key): it books.
    if (error instanceof BookingStateConflict) return { kind: "already", bookingId: booking.id };
    await releaseHold(holdId, holdKey(booking.id, "release"));
    throw error;
  }

  const [given, family] = [booking.leadGivenName, booking.leadFamilyName];
  const [countryCode = "", number = ""] = booking.leadPhone.replace(/^\+/, "").split(" ");
  try {
    const result = await supplierOf(deps).book(
      { bookToken: booking.bookToken, affiliateReferenceId: booking.reference, lead: { givenName: given, familyName: family, email: booking.leadEmail, phone: { countryCode, number } } },
      ctx.supplierContext,
    );
    await confirmBooking(booking.id, holdId, { itineraryId: result.itineraryId, links: result.links }, ctx.userId, "Supplier confirmed the booking");
    return { kind: "confirmed", bookingId: booking.id };
  } catch (error) {
    if (definiteNo(error)) {
      await failBooking(booking.id, holdId, ctx.userId, `Supplier refused the booking: ${error.message}`.slice(0, 200));
      return { kind: "failed", bookingId: booking.id };
    }
    // No clear answer (or our own error after the call): the booking may exist. Keep the hold
    // and find out by affiliate reference. Never book again.
    console.error(`booking outcome unknown: ${error instanceof Error ? error.name : "Error"}`);
    await scheduleReconcile(booking.id, 1, new Date(now.getTime() + RECONCILE_DELAY_MS));
    return { kind: "pending", bookingId: booking.id };
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
  await db.$transaction((tx) =>
    transition(tx, {
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
    }),
  );
}

async function failBooking(bookingId: string, holdId: string, actorUserId: string | null, reason: string): Promise<void> {
  await releaseHold(holdId, holdKey(bookingId, "release"));
  await db.$transaction((tx) =>
    transition(tx, { bookingId, from: "PENDING_CONFIRMATION", to: "FAILED", actorUserId, reason, data: { failureReason: reason, bookToken: null } }),
  );
}

// The background job for bookings without a clear supplier answer (and cancellations).
export async function reconcile(bookingId: string, deps: Deps = {}): Promise<"confirmed" | "failed" | "cancelled" | "restored" | "retry" | "nothing"> {
  const now = deps.now ?? new Date();
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return "nothing";
  const supplier = supplierOf(deps);
  const attempt = booking.reconcileAttempts + 1;
  const retry = async (delayMs: number, data: Prisma.BookingUpdateInput = {}) => {
    await db.booking.update({ where: { id: booking.id }, data: { ...data, reconcileAttempts: attempt } });
    if (attempt < MAX_RECONCILE_ATTEMPTS) await scheduleReconcile(booking.id, attempt + 1, new Date(now.getTime() + delayMs));
    else console.error(`booking ${booking.reference}: reconcile gave up, needs an admin`);
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
      itinerary = await supplier.retrieve((booking.supplierLinks ?? {}) as SupplierLinks, {});
    } catch (error) {
      if (error instanceof SupplierError) return retry(RECONCILE_DELAY_MS * 2);
      throw error;
    }
    const room = itinerary.rooms.find((r) => r.id === booking.supplierRoomId) ?? itinerary.rooms[0];
    if (room?.status === "cancelled") {
      await finishCancel(booking, null, "Reconciled: supplier cancelled the booking");
      return "cancelled";
    }
    if (room?.status === "booked") {
      await db.$transaction((tx) =>
        transition(tx, { bookingId: booking.id, from: "CANCEL_PENDING", to: "CONFIRMED", actorUserId: null, reason: "Reconciled: the cancellation did not go through", data: { cancelChargeMinor: null } }),
      );
      return "restored";
    }
    return retry(RECONCILE_DELAY_MS * 2);
  }
  return "nothing";
}

export type CancelQuote = { allowed: true; chargeMinor: number; refundMinor: number } | { allowed: false; reason: string };

// What cancelling now would cost (shown before the agent confirms).
export function cancelQuote(booking: Booking, now: Date): CancelQuote {
  if (booking.status !== "CONFIRMED") return { allowed: false, reason: "Only a confirmed booking can be cancelled." };
  const charge = cancelChargeAt(
    { refundable: booking.refundable, totalMinor: booking.totalMinor, currency: booking.currency, checkin: booking.checkin, penalties: booking.cancelPenalties as unknown as CancelPenalty[] },
    now,
  );
  if (charge.kind === "stay_started") return { allowed: false, reason: "The stay has started. Contact Apolles support to change it." };
  if (charge.kind === "unknown") return { allowed: false, reason: "This cancellation needs Apolles support: the charge cannot be worked out automatically." };
  return { allowed: true, chargeMinor: charge.minor, refundMinor: booking.totalMinor - charge.minor };
}

async function finishCancel(booking: Booking, actorUserId: string | null, reason: string): Promise<void> {
  const charge = booking.cancelChargeMinor ?? booking.totalMinor;
  const refund = booking.totalMinor - charge;
  // The refund is written only now that the supplier confirmed (idempotent key).
  if (refund > 0) {
    await credit({ agencyId: booking.agencyId, type: "REFUND", amountCents: refund, reason: `Refund for cancelled booking ${booking.reference}`, idempotencyKey: holdKey(booking.id, "refund"), bookingRef: booking.reference });
  }
  await db.$transaction((tx) =>
    transition(tx, { bookingId: booking.id, from: "CANCEL_PENDING", to: "CANCELLED", actorUserId, reason, data: { refundMinor: refund, cancelledAt: new Date() } }),
  );
}

export type CancelOutcome = { kind: "cancelled" | "pending" | "refused" | "not_allowed"; message?: string };

// Screen 12: the agent cancels. Today's charge is fixed when the agent asks, and the refund
// (total − charge) is written only after the supplier confirms.
export async function cancel(ctx: BookingContext, bookingId: string, confirm: { expectedChargeMinor: number }, deps: Deps = {}): Promise<CancelOutcome> {
  const now = deps.now ?? new Date();
  const booking = await ownBooking(ctx.agencyId, bookingId);
  const quote = cancelQuote(booking, now);
  if (!quote.allowed) return { kind: "not_allowed", message: quote.reason };
  if (quote.chargeMinor !== confirm.expectedChargeMinor) return { kind: "not_allowed", message: "The cancellation charge changed. Check it again." };
  const supplier = supplierOf(deps);

  let cancelLink = (booking.supplierLinks as SupplierLinks | null)?.cancel ?? null;
  let roomId = booking.supplierRoomId;
  if (!cancelLink) {
    try {
      const itinerary = await supplier.retrieve((booking.supplierLinks ?? {}) as SupplierLinks, ctx.supplierContext);
      const room = itinerary.rooms[0];
      cancelLink = room?.cancelLink ?? null;
      roomId = room?.id ?? null;
    } catch (error) {
      if (error instanceof SupplierError) return { kind: "refused", message: "The booking could not be cancelled right now. Try again in a few minutes." };
      throw error;
    }
    if (!cancelLink) return { kind: "not_allowed", message: "This booking cannot be cancelled online. Contact Apolles support." };
  }

  try {
    await db.$transaction((tx) =>
      transition(tx, {
        bookingId: booking.id,
        from: "CONFIRMED",
        to: "CANCEL_PENDING",
        actorUserId: ctx.userId,
        reason: "Agent asked to cancel",
        data: { cancelChargeMinor: quote.chargeMinor, supplierRoomId: roomId, supplierLinks: { ...((booking.supplierLinks ?? {}) as SupplierLinks), cancel: cancelLink } },
      }),
    );
  } catch (error) {
    if (error instanceof BookingStateConflict) return { kind: "not_allowed", message: "This booking is already being cancelled." };
    throw error;
  }
  const pending = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
  try {
    await supplier.cancelRoom(cancelLink, ctx.supplierContext);
  } catch (error) {
    if (definiteNo(error)) {
      await db.$transaction((tx) =>
        transition(tx, { bookingId: booking.id, from: "CANCEL_PENDING", to: "CONFIRMED", actorUserId: ctx.userId, reason: `Supplier refused the cancellation: ${error.message}`.slice(0, 200), data: { cancelChargeMinor: null } }),
      );
      return { kind: "refused", message: "The supplier did not accept the cancellation. Contact Apolles support." };
    }
    console.error(`cancellation outcome unknown: ${error instanceof Error ? error.name : "Error"}`);
    await scheduleReconcile(booking.id, booking.reconcileAttempts + 1, new Date(now.getTime() + RECONCILE_DELAY_MS));
    return { kind: "pending" };
  }
  await finishCancel(pending, ctx.userId, "Supplier confirmed the cancellation");
  return { kind: "cancelled" };
}

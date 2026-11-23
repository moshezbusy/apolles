import type { Booking, BookingRoom } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { lockQuoteOfBooking, syncQuoteOfBooking } from "@/server/quotes/quote-booking";
import { bookingSupplier } from "@/server/supplier";
import { SupplierError } from "@/server/supplier/expedia/client";
import type { BookingSupplier, RetrievedItinerary, SupplierAdapter } from "@/server/supplier/types";
import { RESTORE_WATCH_MS, flagForAdmin, queueEmail, reconcile, roomsOf, scheduleReconcile, supplierRoomFor, supplierView } from "./service";
import { BookingStateConflict, transition } from "./states";

// The upkeep of bookings, run by scheduled jobs (src/server/jobs/schedule.ts). None of it
// touches the wallet by itself, and none of it books or cancels anything at the supplier.
//   sweepWaitingBookings      every 10 minutes: a booking waiting for the supplier always has a
//                             check queued, whatever happened to the job that was meant to do it.
//   checkConfirmedAtSupplier  daily: finds confirmed bookings the hotel or the supplier cancelled.
//   expireOldDrafts           daily: drafts nobody booked expire, and their personal details go.

type Supplier = SupplierAdapter & BookingSupplier;
type Deps = { supplier?: Supplier; now?: Date };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// A booking that changed this recently has its own job (queued with the change).
const SWEEP_SETTLE_MS = 2 * MINUTE_MS;
// The longest a check waits for its next try is 6 hours (service.ts): a queued check further
// away than that is a late look at something else, not this booking's next check.
const SWEEP_HORIZON_MS = 6 * HOUR_MS + 30 * MINUTE_MS;
const SWEEP_BATCH = 500;

// Every booking in PENDING_CONFIRMATION or CANCEL_PENDING must have a check (booking.reconcile)
// running or queued soon. The checks queue their own next try, but a chain of one-shot jobs can
// break (a job that failed three times on an error of ours, a crash between two writes): this
// finds the bookings left without one and queues it. Returns how many it queued.
export async function sweepWaitingBookings(now: Date = new Date()): Promise<number> {
  const settledBefore = new Date(now.getTime() - SWEEP_SETTLE_MS);
  const horizon = new Date(now.getTime() + SWEEP_HORIZON_MS);
  const waiting = await db.$queryRaw<{ id: string }[]>`
    SELECT b."id" FROM "Booking" b
    WHERE b."status" IN ('PENDING_CONFIRMATION', 'CANCEL_PENDING') AND b."updatedAt" < ${settledBefore}
      AND NOT EXISTS (
        SELECT 1 FROM "Job" j
        WHERE j."kind" = 'booking.reconcile' AND j."payload"->>'bookingId' = b."id"
          AND (j."status" = 'RUNNING' OR (j."status" = 'QUEUED' AND j."runAt" <= ${horizon}))
      )
    ORDER BY b."updatedAt"
    LIMIT ${SWEEP_BATCH}`;
  for (const { id } of waiting) await scheduleReconcile(id, now);
  if (waiting.length > 0) console.error(`booking sweep: ${waiting.length} waiting bookings had no check queued; one was queued for each`);
  return waiting.length;
}

const CHECK_WINDOW_DAYS = 14;
const CHECK_BATCH = 100;
const CHECK_AGAIN_AFTER_MS = 3 * HOUR_MS;
const CHECK_MAX_FAILURES_IN_A_ROW = 5;

export type SupplierCheckScope = "window" | "eve";
export type SupplierCheckResult = { checked: number; cancelled: number; flagged: number; unread: number };

// A cancellation made by the hotel or by the supplier never reaches us by itself: this reads
// each confirmed booking at the supplier. "window": every booking checking in within the next 14
// days, once a day. "eve": once more for the bookings checking in today or tomorrow.
//   Every room cancelled there  → CANCELLED_BY_SUPPLIER, an email to the agent and to the admin
//                                 alert address, flagged for an admin. No refund is made here:
//                                 an admin checks what the supplier refunds and records it.
//   Only some rooms, or the booking is not found there → flagged for an admin, nothing else.
//   A cancellation of the agent's own that was put back less than a day ago → the watch in
//                                 reconcile finishes it properly (with its refund).
// A booking that cannot be read is counted and skipped; five in a row stop the run with an
// error (the supplier is down: the job is tried again and goes on where it stopped).
export async function checkConfirmedAtSupplier(scope: SupplierCheckScope, deps: Deps = {}): Promise<SupplierCheckResult> {
  const now = deps.now ?? new Date();
  const supplier = deps.supplier ?? bookingSupplier();
  const today = now.toISOString().slice(0, 10);
  const last = new Date(now.getTime() + (scope === "eve" ? 1 : CHECK_WINDOW_DAYS) * DAY_MS).toISOString().slice(0, 10);
  const readBefore = new Date(now.getTime() - CHECK_AGAIN_AFTER_MS);
  const result: SupplierCheckResult = { checked: 0, cancelled: 0, flagged: 0, unread: 0 };
  let failuresInARow = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch: Booking[] = await db.booking.findMany({
      where: { status: "CONFIRMED", checkin: { gte: today, lte: last }, OR: [{ supplierCheckedAt: null }, { supplierCheckedAt: { lt: readBefore } }] },
      orderBy: { id: "asc" },
      take: CHECK_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const booking of batch) {
      let itinerary: RetrievedItinerary | null;
      try {
        itinerary = await supplierView(booking, supplier);
      } catch (error) {
        if (!(error instanceof SupplierError)) throw error;
        result.unread += 1;
        failuresInARow += 1;
        if (failuresInARow >= CHECK_MAX_FAILURES_IN_A_ROW) throw new Error(`The supplier is not answering: the check of confirmed bookings stopped after ${CHECK_MAX_FAILURES_IN_A_ROW} failures in a row`);
        continue;
      }
      failuresInARow = 0;
      result.checked += 1;
      await db.booking.updateMany({ where: { id: booking.id }, data: { supplierCheckedAt: now } });
      const outcome = await settleChecked(booking, itinerary, supplier, now);
      if (outcome === "cancelled") result.cancelled += 1;
      if (outcome === "flagged") result.flagged += 1;
    }
    if (batch.length < CHECK_BATCH) break;
    cursor = batch[batch.length - 1]!.id;
  }
  console.info(`supplier check (${scope}): ${result.checked} read, ${result.cancelled} cancelled by the supplier, ${result.flagged} flagged, ${result.unread} not readable`);
  return result;
}

async function settleChecked(booking: Booking, itinerary: RetrievedItinerary | null, supplier: Supplier, now: Date): Promise<"ok" | "cancelled" | "flagged"> {
  const flag = async (reason: string, log: string) => {
    if (await db.$transaction((tx) => flagForAdmin(tx, booking.id, reason))) console.error(`booking ${booking.reference}: ${log}, needs an admin`);
    return "flagged" as const;
  };
  if (!itinerary) return flag("The supplier does not find this confirmed booking: an admin checks it", "confirmed here but not found at the supplier");
  const rooms = await roomsOf(booking);
  const active = rooms.filter((room) => room.status === "ACTIVE");
  const cancelledThere = active.filter((room) => supplierRoomFor(booking, rooms, room, itinerary)?.status === "cancelled");
  if (cancelledThere.length === 0) return "ok";
  // The agent's own cancellation, put back less than a day ago: it went through late.
  if (booking.cancelRestoredAt && now.getTime() - booking.cancelRestoredAt.getTime() <= RESTORE_WATCH_MS) {
    await reconcile(booking.id, { supplier, now });
    return "ok";
  }
  if (cancelledThere.length < active.length || active.length < rooms.length) {
    const room = cancelledThere[0]!;
    return flag(`Room ${room.index + 1} of ${rooms.length} is cancelled at the supplier while the booking is confirmed: an admin settles it`, "a room is cancelled at the supplier while the booking is confirmed");
  }
  return (await markCancelledBySupplier(booking, active, now)) ? "cancelled" : "ok";
}

// CONFIRMED → CANCELLED_BY_SUPPLIER, in one transaction with its rooms, its trail, the admin flag
// and both emails. The wallet is not touched: the refund is an admin's step (approved spec),
// after checking what the supplier gives back. A booking from a quote reopens the quote, as with
// any cancellation. False when the booking moved on meanwhile (the agent is cancelling it).
async function markCancelledBySupplier(booking: Booking, rooms: BookingRoom[], now: Date): Promise<boolean> {
  try {
    await db.$transaction(async (tx) => {
      await lockQuoteOfBooking(tx, booking.id);
      await transition(tx, {
        bookingId: booking.id,
        from: "CONFIRMED",
        to: "CANCELLED_BY_SUPPLIER",
        actorUserId: null,
        reason: "The supplier shows the booking cancelled: cancelled by the hotel or the supplier, not by the agent. No refund was made",
        data: { cancelledAt: now },
      });
      await tx.bookingRoom.updateMany({ where: { id: { in: rooms.map((room) => room.id) }, bookingId: booking.id, status: "ACTIVE" }, data: { status: "CANCELLED", cancelledAt: now } });
      await syncQuoteOfBooking(tx, booking.id);
      await flagForAdmin(tx, booking.id, "Cancelled by the hotel or the supplier: check the refund with the supplier and record it on the wallet by hand");
      await queueEmail(tx, booking.id, "cancelled_by_supplier");
      await queueEmail(tx, booking.id, "cancelled_by_supplier_admin");
    });
  } catch (error) {
    if (error instanceof BookingStateConflict) return false;
    throw error;
  }
  console.error(`booking ${booking.reference}: cancelled at the supplier, not by the agent; marked cancelled by the hotel, no refund made, needs an admin`);
  return true;
}

const DRAFT_EXPIRES_AFTER_MS = 7 * DAY_MS;
const DRAFT_BATCH = 200;
const DRAFT_MAX_BATCHES = 25;

// A draft is guest details with nothing held and nothing sent. One that nobody touched for 7
// days expires (DRAFT → EXPIRED, with a row in its trail), and the personal details in it are
// removed: guest names, the lead guest's email and phone, the request text, the agent's IP and
// browser, and the supplier tokens. The hotel, dates and price stay, for the record. In batches,
// at most 5,000 drafts a run. Returns how many expired.
export async function expireOldDrafts(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - DRAFT_EXPIRES_AFTER_MS);
  let expired = 0;
  for (let batch = 0; batch < DRAFT_MAX_BATCHES; batch++) {
    const drafts = await db.booking.findMany({ where: { status: "DRAFT", updatedAt: { lt: before } }, orderBy: { updatedAt: "asc" }, take: DRAFT_BATCH, select: { id: true } });
    let moved = 0;
    for (const { id } of drafts) {
      try {
        await db.$transaction(async (tx) => {
          await transition(tx, {
            bookingId: id,
            from: "DRAFT",
            to: "EXPIRED",
            actorUserId: null,
            reason: "Draft not booked within 7 days: expired, personal details removed",
            data: { leadGivenName: "", leadFamilyName: "", leadEmail: "", leadPhone: "", guests: [], specialRequest: "", agentIp: null, agentUserAgent: null, bookToken: null, priceCheckToken: "" },
          });
          await tx.bookingRoom.updateMany({ where: { bookingId: id }, data: { guests: [], givenName: "", familyName: "" } });
        });
        moved += 1;
      } catch (error) {
        if (!(error instanceof BookingStateConflict)) throw error; // booked just now: no longer a draft
      }
    }
    expired += moved;
    // Fewer than a full batch, or nothing could be moved: done (never the same rows forever).
    if (drafts.length < DRAFT_BATCH || moved === 0) break;
  }
  return expired;
}

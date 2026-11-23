import { z } from "zod";
import { cleanupSupplierLog } from "@/server/admin/bookings";
import { BOOKING_EMAIL_EVENTS, sendBookingEmail, sendFreeCancelReminders } from "@/server/booking/emails";
import { lowBalanceCheck, sendTopupEmail } from "@/server/wallet/notifications";
import { flagReconcileFailed, reconcile } from "@/server/booking/service";
import { checkConfirmedAtSupplier, sweepWaitingBookings } from "@/server/booking/upkeep";
import { syncCatalog } from "@/server/content/catalog-sync";
import { syncInactive } from "@/server/content/inactive-sync";
import { syncRegions } from "@/server/content/regions-sync";
import { cleanupSnapshots } from "@/server/search/search";
import { dailyCleanup } from "./cleanup";
import type { FinalFailureHandler, Handlers } from "./runner";

const reconcilePayload = z.object({ bookingId: z.string().min(1).max(64) }).strict();

// The handler of every job kind (plan 2b). A kind without a handler fails visibly
// (lastError "no handler") instead of being skipped.
export const HANDLERS: Handlers = {
  "content.catalog": async () => {
    await syncCatalog();
  },
  "content.regions": async () => {
    await syncRegions();
  },
  "content.inactive": async () => {
    await syncInactive();
  },
  "search.cleanup": async () => {
    await cleanupSnapshots();
  },
  // Supplier calls are kept 90 days (spec section 6).
  "supplier-log.cleanup": async () => {
    await cleanupSupplierLog();
  },
  // Booking emails (confirmed, not confirmed, cancelled; needs attention to the admin).
  "email.booking": async (payload) => {
    const { bookingId, event } = z.object({ bookingId: z.string().min(1).max(64), event: z.enum(BOOKING_EMAIL_EVENTS) }).strict().parse(payload);
    await sendBookingEmail(bookingId, event);
  },
  // "USD X added to your Apolles balance" after a bank transfer is confirmed (email #18).
  "email.topup": async (payload) => {
    const { entryId } = z.object({ entryId: z.string().min(1).max(64) }).strict().parse(payload);
    await sendTopupEmail(entryId);
  },
  // "Your Apolles balance is low" (email #19), after a booking is paid.
  "email.low-balance": async (payload) => {
    const { agencyId } = z.object({ agencyId: z.string().min(1).max(64) }).strict().parse(payload);
    await lowBalanceCheck(agencyId);
  },
  // "Free cancellation ends in 72 hours" (email #14), every hour.
  "booking.cancel-reminders": async () => {
    await sendFreeCancelReminders();
  },
  // A booking or cancellation without a clear supplier answer (plan 3). It never books again.
  "booking.reconcile": async (payload) => {
    const { bookingId } = reconcilePayload.parse(payload);
    await reconcile(bookingId);
  },
  // Every 10 minutes: a booking waiting for the supplier always has a check queued.
  "booking.sweep": async () => {
    await sweepWaitingBookings();
  },
  // Daily (and once more for bookings about to check in): confirmed bookings are read at the
  // supplier, so a cancellation by the hotel or the supplier is found.
  "booking.supplier-check": async (payload) => {
    const { scope } = z.object({ scope: z.enum(["window", "eve"]) }).strict().parse(payload);
    await checkConfirmedAtSupplier(scope);
  },
  // Daily: old drafts expire, and expired sessions, tokens, finished jobs and old hotel content go.
  "cleanup.daily": async () => {
    await dailyCleanup();
  },
};

// A job that failed for the last time. The runner has logged it; a booking check that died this
// way also flags its booking for an admin (the sweeper queues a new check, so it goes on).
export const onFinalFailure: FinalFailureHandler = async (job) => {
  if (job.kind !== "booking.reconcile") return;
  const payload = reconcilePayload.safeParse(job.payload);
  if (payload.success) await flagReconcileFailed(payload.data.bookingId);
};

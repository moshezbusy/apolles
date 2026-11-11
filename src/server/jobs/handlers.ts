import { z } from "zod";
import { cleanupSupplierLog } from "@/server/admin/bookings";
import { BOOKING_EMAIL_EVENTS, sendBookingEmail } from "@/server/booking/emails";
import { reconcile } from "@/server/booking/service";
import { syncCatalog } from "@/server/content/catalog-sync";
import { syncInactive } from "@/server/content/inactive-sync";
import { syncRegions } from "@/server/content/regions-sync";
import { cleanupSnapshots } from "@/server/search/search";
import type { Handlers } from "./runner";

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
  // A booking or cancellation without a clear supplier answer (plan 3). It never books again.
  "booking.reconcile": async (payload) => {
    const { bookingId } = z.object({ bookingId: z.string().min(1).max(64) }).strict().parse(payload);
    await reconcile(bookingId);
  },
};

import { freeCancelDeadline, freeCancelUntilText } from "@/lib/cancellation";
import type { CancelPenalty } from "@/server/supplier/types";
import { CANCEL_MARGIN_MS } from "./cancel-charge";

// The one wording for a stored booking's free cancellation (review page, bookings list, booking
// page, emails, voucher): "Free cancellation until Wed, Apr 7, 2027, 00:00 hotel time", from the
// first charge's own timestamp (src/lib/cancellation.ts), or null when none is promised. Whether
// it is still open is decided with the booking's stored deadline, which already has the safety
// margin the charge is worked out with (freeCancelEnds in service.ts, cancel-charge.ts); a booking
// stored without one gets the same margin here.
export type StoredCancelTerms = {
  refundable: boolean;
  cancelPenalties: unknown;
  nonrefundableDateRanges?: unknown;
  freeCancelEndsAt?: Date | null;
};

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function freeCancelText(b: StoredCancelTerms, now: Date): string | null {
  const deadline = freeCancelDeadline({
    refundable: b.refundable,
    cancelPenalties: list<CancelPenalty>(b.cancelPenalties),
    nonrefundableDateRanges: list(b.nonrefundableDateRanges),
  });
  if (!deadline) return null;
  const ends = b.freeCancelEndsAt ? b.freeCancelEndsAt.getTime() : deadline.at.getTime() - CANCEL_MARGIN_MS;
  return ends > now.getTime() ? freeCancelUntilText(deadline.start) : null;
}

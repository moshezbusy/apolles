import type { Money } from "./supplier-money";

// The one rule for "free cancellation" (scan fix, 2026-11-23), shared by the short label next to
// a price, the stored search rate, the results filter and the hotel page filter, so they never
// disagree. It is the same rule as the booking's deadline (freeCancelEnds in
// src/server/booking/service.ts): free cancellation is promised only when the supplier calls the
// rate refundable, lists its charges, names no nights that cannot be refunded, every date reads,
// and the first charge has not started yet. Anything else is never called free: the label says
// that charges apply, or that the rate is non-refundable.
// Pure (no database, no server code), so pages, emails and documents can all use it.

export type CancelTerms = {
  refundable: boolean; // the supplier's "fully refundable now"
  cancelPenalties: { start: string; amount?: Money | null; nights?: number | null; percent?: string | null }[];
  nonrefundableDateRanges?: unknown[];
  // The stay's price, when known: tells a full charge from a part of it.
  price?: { total: Money; nights: number };
};

// When free cancellation ends: the start of the first charge, as an instant and as the supplier
// wrote it (the hotel's clock with its offset). null: no free cancellation is promised.
export function freeCancelDeadline(terms: CancelTerms): { at: Date; start: string } | null {
  if (!terms.refundable || (terms.nonrefundableDateRanges?.length ?? 0) > 0) return null;
  let first: { time: number; start: string } | null = null;
  for (const penalty of terms.cancelPenalties) {
    const time = Date.parse(penalty.start);
    if (!Number.isFinite(time)) return null;
    if (!first || time < first.time) first = { time, start: penalty.start };
  }
  return first ? { at: new Date(first.time), start: first.start } : null;
}

// Free cancellation that is still ahead at `now`; null when there is none or it is over.
export function freeCancellation(terms: CancelTerms, now: Date): { at: Date; start: string } | null {
  const deadline = freeCancelDeadline(terms);
  return deadline && deadline.at.getTime() > now.getTime() ? deadline : null;
}

// A charge of the whole price: 100%, the stay's total or more, or every night of the stay.
function isFullCharge(penalty: CancelTerms["cancelPenalties"][number], price: CancelTerms["price"]): boolean {
  if (penalty.percent && /^100(\.0+)?\s?%$/.test(penalty.percent.trim())) return true;
  if (!price) return false;
  if (penalty.amount && penalty.amount.currency === price.total.currency && penalty.amount.minor >= price.total.minor) return true;
  return typeof penalty.nights === "number" && penalty.nights >= price.nights;
}

// Nothing comes back on cancelling: the supplier calls the rate not refundable and lists no
// charge, or only charges of the whole price.
export function isNonRefundable(terms: CancelTerms): boolean {
  return !terms.refundable && terms.cancelPenalties.every((penalty) => isFullCharge(penalty, terms.price));
}

// Refundable, but the supplier listed no charge and so named no deadline: nothing is promised.
export function hasNoCancelDeadline(terms: CancelTerms): boolean {
  return terms.refundable && terms.cancelPenalties.length === 0 && (terms.nonrefundableDateRanges?.length ?? 0) === 0;
}

export type CancellationKind = "free" | "charges" | "unknown" | "non_refundable";

// The short wording next to a price. "unknown": refundable, but the supplier named no deadline.
export function cancellationSummary(terms: CancelTerms, now: Date): { kind: CancellationKind; text: string } {
  const free = freeCancellation(terms, now);
  if (free) return { kind: "free", text: freeCancelUntilText(free.start) };
  if (isNonRefundable(terms)) return { kind: "non_refundable", text: "Non-refundable" };
  if (hasNoCancelDeadline(terms)) return { kind: "unknown", text: "Cancellation charges may apply" };
  return { kind: "charges", text: "Cancellation charges apply" };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2027-04-07T00:00:00.000+02:00" → "Wed, Apr 7, 2027, 00:00 hotel time": the hotel's own clock,
// read from the supplier's timestamp as written (its offset is the hotel's), never converted to
// another time zone. Text that is not such a timestamp comes back as it is.
export function hotelDateTime(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return value;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value; // no "Feb 30"
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[month - 1]} ${day}, ${year}, ${m[4]}:${m[5]} hotel time`;
}

// The one wording for the deadline, from the first charge's start as the supplier wrote it.
export function freeCancelUntilText(start: string): string {
  return `Free cancellation until ${hotelDateTime(start)}`;
}

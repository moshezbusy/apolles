import type { CancelPenalty } from "@/server/supplier/types";

// What cancelling at `now` costs, from the supplier's own cancellation penalties, in integer
// minor units. The refund is total − charge. Nothing is rounded: a charge that cannot be worked
// out exactly (a number of nights, a percentage that does not divide, another currency) is
// "unknown", and the cancellation goes to Apolles support instead of guessing an amount.

export type ChargeResult = { kind: "charge"; minor: number } | { kind: "unknown" } | { kind: "stay_started" };

type Input = {
  refundable: boolean;
  totalMinor: number;
  currency: string;
  checkin: string;
  penalties: CancelPenalty[];
  nonrefundableDateRanges?: { start: string; end: string }[];
};

function chargeOf(p: CancelPenalty, total: number, currency: string): number | null {
  if (p.amount) return p.amount.currency === currency ? Math.min(p.amount.minor, total) : null;
  if (p.percent) {
    const match = p.percent.match(/^(\d{1,3})(?:\.0+)?%$/);
    if (!match) return null;
    const pct = Number(match[1]);
    if (pct > 100) return null;
    return (total * pct) % 100 === 0 ? (total * pct) / 100 : null; // exact only
  }
  return null; // nights: needs the nightly split, not guessed
}

export function cancelChargeAt(input: Input, now: Date): ChargeResult {
  const t = now.getTime();
  const checkinUtc = Date.parse(`${input.checkin}T00:00:00Z`);
  const windows = input.penalties
    .map((p) => ({ p, start: Date.parse(p.start), end: Date.parse(p.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  if (windows.length !== input.penalties.length) return { kind: "unknown" };

  // Some nights of a refundable rate are not refundable: the supplier keeps them, and their
  // value is not split out here. Support works the refund out instead of a guess.
  if (input.refundable && (input.nonrefundableDateRanges?.length ?? 0) > 0) {
    return t >= checkinUtc ? { kind: "stay_started" } : { kind: "unknown" };
  }
  if (!input.refundable) {
    return t >= checkinUtc ? { kind: "stay_started" } : { kind: "charge", minor: input.totalMinor };
  }
  const active = windows.filter((w) => w.start <= t && t < w.end);
  if (active.length > 0) {
    let max = 0;
    for (const w of active) {
      const c = chargeOf(w.p, input.totalMinor, input.currency);
      if (c === null) return { kind: "unknown" };
      max = Math.max(max, c);
    }
    return { kind: "charge", minor: max };
  }
  const lastEnd = Math.max(checkinUtc, ...windows.map((w) => w.end));
  if (t >= lastEnd) return { kind: "stay_started" };
  return { kind: "charge", minor: 0 }; // before every penalty: free
}

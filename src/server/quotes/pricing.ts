import type { CancelPenalty } from "@/server/supplier/types";

// Prices and dates on a quote (plan 5b). The net is the supplier's inclusive total (what the
// agency would pay, BP5) and is never recomputed. The selling price is the agency's own price to
// its client: a price the agent typed, or the net plus the quote's markup. Integer cents only.

export type Markup = { markupType: "PERCENT" | "FIXED"; markupValue: number };
export type PricedRoom = { netMinor: number; sellMinor: number | null };

export function sellingMinor(room: PricedRoom, markup: Markup): number {
  if (room.sellMinor !== null) return room.sellMinor;
  if (markup.markupType === "FIXED") return room.netMinor + markup.markupValue;
  // net × basis points / 10,000, rounded half up once (amounts are never negative).
  return room.netMinor + Math.floor((room.netMinor * markup.markupValue + 5_000) / 10_000);
}

export function profitMinor(room: PricedRoom, markup: Markup): number {
  return sellingMinor(room, markup) - room.netMinor;
}

// What the agent typed in "Markup on this quote": a percent (up to 2 decimals, 0 to 100) or USD
// per room (up to 10,000, with cents). Empty means 0. null = not valid.
export function parseMarkup(type: string, raw: string): Markup | null {
  const value = raw.trim() === "" ? "0" : raw.trim();
  const m = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) return null;
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (type === "PERCENT") return hundredths <= 10_000 ? { markupType: "PERCENT", markupValue: hundredths } : null;
  if (type === "FIXED") return hundredths <= 1_000_000 ? { markupType: "FIXED", markupValue: hundredths } : null;
  return null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// The last whole day on which cancelling costs nothing: the day before the first charge starts,
// in the hotel's own calendar (the date part of Expedia's time, never converted). null for a
// non-refundable rate, or a refundable one with no charge listed.
export function lastFreeDay(offer: { refundable: boolean; cancelPenalties: CancelPenalty[] }): string | null {
  if (!offer.refundable) return null;
  const first = offer.cancelPenalties.map((p) => p.start.slice(0, 10)).filter(isRealDay).sort()[0];
  return first ? addDays(first, -1) : null;
}

// The client's date starts one day before the supplier's (mockup 15), so the agency has time to
// cancel for the client.
export function defaultClientDate(lastFree: string): string {
  return addDays(lastFree, -1);
}

// The agent may show the client an earlier date, never a later one, and never a day in the past.
export function clientDateAllowed(date: string, lastFree: string, today: string): boolean {
  return isRealDay(date) && date <= lastFree && date >= today;
}

// Date helpers for the calendar (plan 9). Dates are ISO "YYYY-MM-DD" strings in UTC, as the
// forms send them and the server checks them; only the screen shows "DD/MM/YYYY".

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Search limit (the server's): a stay is 1 to 28 nights.
export const MAX_NIGHTS = 28;

function toTime(iso: string): number | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(time).toISOString().slice(0, 10) === iso ? time : null;
}

export function isIsoDate(value: string): boolean {
  return toTime(value) !== null;
}

// "2026-12-03" → "03/12/2026"; anything that is not a real ISO date → "".
export function formatDmy(iso: string): string {
  if (toTime(iso) === null) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function addDays(iso: string, days: number): string {
  const time = toTime(iso);
  if (time === null) return "";
  return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightsBetween(checkin: string, checkout: string): number | null {
  const a = toTime(checkin);
  const b = toTime(checkout);
  if (a === null || b === null) return null;
  const n = (b - a) / DAY_MS;
  return n > 0 ? n : null;
}

export type Month = { year: number; month: number }; // month 0-11

export function monthOf(iso: string): Month | null {
  const time = toTime(iso);
  if (time === null) return null;
  const date = new Date(time);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function shiftMonth({ year, month }: Month, by: number): Month {
  const index = year * 12 + month + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

// Six Sunday-first weeks; days outside the month are null.
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array<string | null>(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  while (cells.length < 42) cells.push(null);
  return Array.from({ length: 6 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

// ISO strings compare in date order.
export function isSelectable(day: string, min: string, max: string): boolean {
  return (min === "" || day >= min) && (max === "" || day <= max);
}

export function checkoutLimits(checkin: string, maxDate: string, maxNights = MAX_NIGHTS): { min: string; max: string } {
  const last = addDays(checkin, maxNights);
  return { min: addDays(checkin, 1), max: maxDate !== "" && maxDate < last ? maxDate : last };
}

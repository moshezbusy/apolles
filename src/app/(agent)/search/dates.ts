import type { SearchFormValues } from "./form-state";

// Date limits in UTC: today to 365 days ahead (the quote editor's stay dates use these).
const DAY_MS = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateRange(now: Date): { minDate: string; maxDate: string } {
  return { minDate: iso(now), maxDate: iso(new Date(now.getTime() + 365 * DAY_MS)) };
}

// Date limits for the search form, like the server check (src/server/search/input.ts): the
// earliest check-in the server takes is yesterday in UTC, which is "today" for an agent in the
// far west; the latest is 365 days ahead. In the browser the form starts its calendar at the
// agent's own today (localToday, kept inside these limits).
export function searchDateRange(now: Date): { minDate: string; maxDate: string } {
  return { minDate: iso(new Date(now.getTime() - DAY_MS)), maxDate: iso(new Date(now.getTime() + 365 * DAY_MS)) };
}

// The date on the agent's own clock (the browser's time zone), as YYYY-MM-DD, never outside
// the limits (a computer with a wrong clock).
export function localToday(minDate: string, maxDate: string, now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return today < minDate ? minDate : today > maxDate ? maxDate : today;
}

// A new search starts two weeks ahead, two nights, one room of two adults.
export function defaultSearchValues(now: Date): SearchFormValues {
  return {
    destinationId: "",
    destinationLabel: "",
    propertyId: "",
    checkin: iso(new Date(now.getTime() + 14 * DAY_MS)),
    checkout: iso(new Date(now.getTime() + 16 * DAY_MS)),
    rooms: [{ adults: "2", childAges: [] }],
  };
}

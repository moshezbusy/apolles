import type { SearchFormValues } from "./form-state";

// Date limits for the search form, in UTC like the server check (check-in today to 365 days).
const DAY_MS = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateRange(now: Date): { minDate: string; maxDate: string } {
  return { minDate: iso(now), maxDate: iso(new Date(now.getTime() + 365 * DAY_MS)) };
}

// A new search starts two weeks ahead, two nights, two adults.
export function defaultSearchValues(now: Date): SearchFormValues {
  return {
    destinationId: "",
    destinationLabel: "",
    checkin: iso(new Date(now.getTime() + 14 * DAY_MS)),
    checkout: iso(new Date(now.getTime() + 16 * DAY_MS)),
    adults: "2",
    childAges: [],
  };
}

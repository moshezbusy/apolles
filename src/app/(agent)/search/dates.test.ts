import { describe, expect, it } from "vitest";
import { dateRange, localToday, searchDateRange } from "./dates";

describe("search dates", () => {
  const now = new Date("2027-03-01T10:00:00.000Z");

  it("the search form takes a check-in from yesterday (UTC): today for an agent in the far west", () => {
    expect(searchDateRange(now)).toEqual({ minDate: "2027-02-28", maxDate: "2028-02-29" });
    // The quote editor's limits are unchanged: today (UTC) to 365 days ahead.
    expect(dateRange(now)).toEqual({ minDate: "2027-03-01", maxDate: "2028-02-29" });
  });

  it("the calendar starts at the agent's own date, never outside the limits", () => {
    const local = new Date(2027, 2, 1, 23, 30); // 1 March, 23:30 on the agent's clock
    expect(localToday("2027-02-28", "2028-02-29", local)).toBe("2027-03-01");
    expect(localToday("2027-02-28", "2028-02-29", new Date(2026, 0, 5))).toBe("2027-02-28"); // a clock set far back
    expect(localToday("2027-02-28", "2028-02-29", new Date(2030, 0, 5))).toBe("2028-02-29");
  });
});

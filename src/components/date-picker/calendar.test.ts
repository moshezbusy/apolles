import { describe, expect, it } from "vitest";
import { addDays, checkoutLimits, formatDmy, isSelectable, monthGrid, monthLabel, nightsBetween, shiftMonth } from "./calendar";

describe("date helpers of the calendar (plan 9)", () => {
  it("shows dates as day/month/year", () => {
    expect(formatDmy("2026-12-03")).toBe("03/12/2026");
    expect(formatDmy("")).toBe("");
    expect(formatDmy("2026-13-40")).toBe("");
    expect(formatDmy("03/12/2026")).toBe("");
  });

  it("adds days across months and years, in UTC", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts nights between two dates", () => {
    expect(nightsBetween("2026-12-03", "2026-12-05")).toBe(2);
    expect(nightsBetween("2026-12-05", "2026-12-03")).toBeNull();
    expect(nightsBetween("", "2026-12-03")).toBeNull();
  });

  it("lays out a month in Sunday-first weeks, six rows, empty cells outside the month", () => {
    const grid = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(grid).toHaveLength(6);
    expect(grid[0]).toEqual([null, null, "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
    expect(grid[4]?.[4]).toBe("2026-12-31");
    expect(grid[5]).toEqual([null, null, null, null, null, null, null]);
    expect(monthLabel(2026, 11)).toBe("December 2026");
  });

  it("moves the shown month forward and back across years", () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
  });

  it("only days between min and max can be picked", () => {
    expect(isSelectable("2026-12-03", "2026-12-03", "2027-12-03")).toBe(true);
    expect(isSelectable("2026-12-02", "2026-12-03", "2027-12-03")).toBe(false);
    expect(isSelectable("2027-12-04", "2026-12-03", "2027-12-03")).toBe(false);
  });

  it("check-out is 1 to 28 nights after check-in, and never past the last date", () => {
    expect(checkoutLimits("2026-12-03", "2027-12-03")).toEqual({ min: "2026-12-04", max: "2026-12-31" });
    expect(checkoutLimits("2027-11-30", "2027-12-03")).toEqual({ min: "2027-12-01", max: "2027-12-03" });
  });
});

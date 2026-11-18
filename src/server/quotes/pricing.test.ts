import { describe, expect, it } from "vitest";
import { addDays, clientDateAllowed, defaultClientDate, lastFreeDay, parseMarkup, profitMinor, sellingMinor } from "@/server/quotes/pricing";

const PCT10 = { markupType: "PERCENT" as const, markupValue: 1000 };
const FIXED25 = { markupType: "FIXED" as const, markupValue: 2500 };

describe("sellingMinor and profitMinor", () => {
  it("a typed price wins over the markup", () => {
    expect(sellingMinor({ netMinor: 100_000, sellMinor: 128_400 }, PCT10)).toBe(128_400);
  });

  it("percentage markup, rounded half up once to the cent", () => {
    expect(sellingMinor({ netMinor: 103_386, sellMinor: null }, PCT10)).toBe(113_725); // 1033.86 + 103.386 → 1137.246 → 1137.25
    expect(sellingMinor({ netMinor: 5, sellMinor: null }, PCT10)).toBe(6); // 0.05 + 0.005 → 0.055 → 0.06
    expect(sellingMinor({ netMinor: 100_000, sellMinor: null }, { markupType: "PERCENT", markupValue: 0 })).toBe(100_000);
  });

  it("fixed markup per room", () => {
    expect(sellingMinor({ netMinor: 100_000, sellMinor: null }, FIXED25)).toBe(102_500);
  });

  it("profit is selling minus net (negative when sold below net)", () => {
    expect(profitMinor({ netMinor: 100_000, sellMinor: null }, PCT10)).toBe(10_000);
    expect(profitMinor({ netMinor: 100_000, sellMinor: 90_000 }, PCT10)).toBe(-10_000);
  });
});

describe("parseMarkup", () => {
  it("percent with up to 2 decimals, 0 to 100", () => {
    expect(parseMarkup("PERCENT", "10")).toEqual({ markupType: "PERCENT", markupValue: 1000 });
    expect(parseMarkup("PERCENT", "12.5")).toEqual({ markupType: "PERCENT", markupValue: 1250 });
    expect(parseMarkup("PERCENT", "")).toEqual({ markupType: "PERCENT", markupValue: 0 });
    expect(parseMarkup("PERCENT", "100.01")).toBeNull();
    expect(parseMarkup("PERCENT", "1.234")).toBeNull();
    expect(parseMarkup("PERCENT", "-1")).toBeNull();
  });

  it("fixed USD per room, up to 10,000, with cents", () => {
    expect(parseMarkup("FIXED", "25.50")).toEqual({ markupType: "FIXED", markupValue: 2550 });
    expect(parseMarkup("FIXED", "10000.01")).toBeNull();
    expect(parseMarkup("OTHER", "1")).toBeNull();
  });
});

describe("cancellation dates", () => {
  const offer = (refundable: boolean, starts: string[]) => ({
    refundable,
    cancelPenalties: starts.map((start) => ({ start, end: start, amount: null, nights: 1, percent: null })),
  });

  it("the last free day is the day before the first charge starts (hotel calendar)", () => {
    expect(lastFreeDay(offer(true, ["2027-10-21T00:00:00.000+02:00", "2027-10-19T12:00:00.000+02:00"]))).toBe("2027-10-18");
  });

  it("no date for a non-refundable rate or a rate with no charge at all", () => {
    expect(lastFreeDay(offer(false, ["2027-10-21T00:00:00.000+02:00"]))).toBeNull();
    expect(lastFreeDay(offer(true, []))).toBeNull();
  });

  it("the client sees one day earlier by default, and never a later date than the supplier's", () => {
    expect(defaultClientDate("2027-10-18")).toBe("2027-10-17");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(clientDateAllowed("2027-10-18", "2027-10-18", "2027-01-01")).toBe(true);
    expect(clientDateAllowed("2027-10-19", "2027-10-18", "2027-01-01")).toBe(false);
    expect(clientDateAllowed("2026-12-31", "2027-10-18", "2027-01-01")).toBe(false);
    expect(clientDateAllowed("2027-02-30", "2027-10-18", "2027-01-01")).toBe(false);
  });
});

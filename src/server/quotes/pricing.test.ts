import { describe, expect, it } from "vitest";
import {
  addDays,
  clientCancelView,
  clientDateAllowed,
  dayAhead,
  defaultClientDate,
  lastFreeDay,
  offerEnd,
  offerLastDay,
  offerOver,
  parseMarkup,
  profitMinor,
  sellingMinor,
  supplierCancelView,
  todayIso,
} from "@/server/quotes/pricing";

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

  it("the client sees one day earlier by default, and never the supplier's last day or a later one", () => {
    expect(defaultClientDate("2027-10-18")).toBe("2027-10-17");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(clientDateAllowed("2027-10-17", "2027-10-18", "2027-01-01")).toBe(true);
    // The supplier's own last day leaves no time to cancel for the client.
    expect(clientDateAllowed("2027-10-18", "2027-10-18", "2027-01-01")).toBe(false);
    expect(clientDateAllowed("2027-10-19", "2027-10-18", "2027-01-01")).toBe(false);
    expect(clientDateAllowed("2026-12-31", "2027-10-18", "2027-01-01")).toBe(false);
    // Today itself is over already (the day ends at its start, in UTC).
    expect(clientDateAllowed("2027-01-01", "2027-10-18", "2027-01-01")).toBe(false);
    expect(clientDateAllowed("2027-02-30", "2027-10-18", "2027-01-01")).toBe(false);
  });

  it("today is the UTC day, and a day is ahead only while it is after today", () => {
    expect(todayIso(new Date("2026-11-23T23:59:59.000Z"))).toBe("2026-11-23");
    expect(dayAhead("2026-11-24", "2026-11-23")).toBe(true);
    expect(dayAhead("2026-11-23", "2026-11-23")).toBe(false);
    expect(dayAhead("2026-11-20", "2026-11-23")).toBe(false);
  });

  it("a free cancellation date that passed is shown as ended, never as free", () => {
    const room = { refundable: true, freeCancelUntil: "2026-11-21", clientCancelUntil: "2026-11-20" };
    expect(clientCancelView(room, "2026-11-10")).toEqual({ kind: "free", until: "2026-11-20" });
    expect(clientCancelView(room, "2026-11-20")).toEqual({ kind: "ended", on: "2026-11-20" });
    expect(clientCancelView(room, "2026-11-23")).toEqual({ kind: "ended", on: "2026-11-20" });
    expect(supplierCancelView(room, "2026-11-20")).toEqual({ kind: "free", until: "2026-11-21" });
    expect(supplierCancelView(room, "2026-11-23")).toEqual({ kind: "ended", on: "2026-11-21" });
  });

  it("the client's date is capped one day before the supplier's, also on a row saved with the same day", () => {
    expect(clientCancelView({ refundable: true, freeCancelUntil: "2026-12-10", clientCancelUntil: "2026-12-10" }, "2026-11-23")).toEqual({ kind: "free", until: "2026-12-09" });
    expect(clientCancelView({ refundable: true, freeCancelUntil: "2026-12-10", clientCancelUntil: null }, "2026-11-23")).toEqual({ kind: "free", until: "2026-12-09" });
  });

  it("no free cancellation for a non-refundable rate or a rate with no date", () => {
    expect(clientCancelView({ refundable: false, freeCancelUntil: "2026-12-10", clientCancelUntil: "2026-12-09" }, "2026-11-23")).toEqual({ kind: "none" });
    expect(clientCancelView({ refundable: true, freeCancelUntil: null, clientCancelUntil: null }, "2026-11-23")).toEqual({ kind: "none" });
    expect(supplierCancelView({ refundable: true, freeCancelUntil: null, clientCancelUntil: null }, "2026-11-23")).toEqual({ kind: "none" });
  });
});

describe("how long an offer is valid", () => {
  it("whole UTC days, today included; it ends at the start of the next UTC day", () => {
    const shared = new Date("2026-11-23T14:30:00.000Z");
    const end = offerEnd(shared, 7);
    expect(end.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(offerLastDay(end)).toBe("2026-11-29");
    expect(offerOver(end, new Date("2026-11-29T23:59:59.000Z"))).toBe(false);
    expect(offerOver(end, new Date("2026-11-30T00:00:00.000Z"))).toBe(true);
    expect(offerOver(null, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
    expect(offerLastDay(offerEnd(shared, 1))).toBe("2026-11-23");
  });
});

import { describe, expect, it } from "vitest";
import { freeCancelText } from "./free-cancel";

const start = "2099-04-07T14:00:00.000+02:00"; // 12:00 UTC
const penalty = { start, end: "2099-04-08T00:00:00.000+02:00", amount: null, nights: 1, percent: null };

describe("freeCancelText", () => {
  it("says the hotel's own time of the first charge, while it is still ahead", () => {
    expect(freeCancelText({ refundable: true, cancelPenalties: [penalty] }, new Date("2099-04-01T00:00:00Z"))).toBe("Free cancellation until Tue, Apr 7, 2099, 14:00 hotel time");
  });

  it("keeps the 10 minute safety margin: 5 minutes before the charge it is no longer promised", () => {
    expect(freeCancelText({ refundable: true, cancelPenalties: [penalty] }, new Date("2099-04-07T11:55:00Z"))).toBeNull();
    expect(freeCancelText({ refundable: true, cancelPenalties: [penalty], freeCancelEndsAt: new Date("2099-04-07T11:50:00Z") }, new Date("2099-04-07T11:49:00Z"))).not.toBeNull();
  });

  it("promises nothing for a non-refundable rate, no listed charge, nights that cannot be refunded or an unreadable date", () => {
    const now = new Date("2099-04-01T00:00:00Z");
    expect(freeCancelText({ refundable: false, cancelPenalties: [penalty] }, now)).toBeNull();
    expect(freeCancelText({ refundable: true, cancelPenalties: [] }, now)).toBeNull();
    expect(freeCancelText({ refundable: true, cancelPenalties: [penalty], nonrefundableDateRanges: [{ start: "2099-04-10", end: "2099-04-11" }] }, now)).toBeNull();
    expect(freeCancelText({ refundable: true, cancelPenalties: [{ ...penalty, start: "soon" }] }, now)).toBeNull();
    expect(freeCancelText({ refundable: true, cancelPenalties: "not a list" }, now)).toBeNull();
  });
});

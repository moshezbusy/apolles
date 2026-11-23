import { describe, expect, it } from "vitest";
import { CANCEL_MARGIN_MS, cancelChargeAt, cancelChargeForRooms } from "./cancel-charge";

const base = { refundable: true, totalMinor: 50_000, currency: "USD", checkin: "2027-04-10" };
const penalty = (start: string, end: string, extra: object) => ({ start, end, amount: null, nights: null, percent: null, ...extra });
const at = (iso: string) => new Date(iso);

describe("cancelChargeAt", () => {
  const penalties = [penalty("2027-04-07T00:00:00+02:00", "2027-04-10T23:59:00+02:00", { amount: { minor: 12_000, currency: "USD" } })];

  it("free before the first penalty starts", () => {
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-05T12:00:00Z"))).toEqual({ kind: "charge", minor: 0 });
  });

  it("the penalty amount while it applies", () => {
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-08T12:00:00Z"))).toEqual({ kind: "charge", minor: 12_000 });
  });

  it("after every penalty and check-in: the stay started", () => {
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-11T12:00:00Z"))).toEqual({ kind: "stay_started" });
  });

  it("non-refundable: the whole total", () => {
    expect(cancelChargeAt({ ...base, refundable: false, penalties: [] }, at("2027-04-01T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
  });

  it("an exact percentage is computed; anything not exact is unknown, never rounded", () => {
    const pct = (p: string) => [penalty("2027-04-01T00:00:00Z", "2027-04-11T00:00:00Z", { percent: p })];
    expect(cancelChargeAt({ ...base, penalties: pct("100%") }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
    expect(cancelChargeAt({ ...base, penalties: pct("50%") }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "charge", minor: 25_000 });
    expect(cancelChargeAt({ ...base, totalMinor: 50_001, penalties: pct("50%") }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "unknown" });
  });

  it("nights, another currency or an unreadable date are unknown", () => {
    const nights = [penalty("2027-04-01T00:00:00Z", "2027-04-11T00:00:00Z", { nights: 1 })];
    expect(cancelChargeAt({ ...base, penalties: nights }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "unknown" });
    const eur = [penalty("2027-04-01T00:00:00Z", "2027-04-11T00:00:00Z", { amount: { minor: 100, currency: "EUR" } })];
    expect(cancelChargeAt({ ...base, penalties: eur }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "unknown" });
    expect(cancelChargeAt({ ...base, penalties: [penalty("soon", "later", { amount: { minor: 1, currency: "USD" } })] }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "unknown" });
  });

  it("a refundable rate with non-refundable nights is unknown (support works it out), never free", () => {
    const ranges = [{ start: "2027-04-10", end: "2027-04-11" }];
    expect(cancelChargeAt({ ...base, penalties: [], nonrefundableDateRanges: ranges }, at("2027-04-01T00:00:00Z"))).toEqual({ kind: "unknown" });
  });

  it("a charge never exceeds the total", () => {
    const big = [penalty("2027-04-01T00:00:00Z", "2027-04-11T00:00:00Z", { amount: { minor: 99_999, currency: "USD" } })];
    expect(cancelChargeAt({ ...base, penalties: big }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
  });
});

// Once the first penalty has started, a moment that no window covers is never a silent free
// cancellation: the highest charge of the windows already started applies (cancelling later is
// never cheaper), or support works it out.
describe("cancelChargeAt: no window covers the moment", () => {
  const usd = (minor: number) => ({ amount: { minor, currency: "USD" } });

  it("the last window ends at the hotel's midnight of check-in day, east of UTC: still that charge until check-in", () => {
    // Ends 2027-04-09T22:00Z; check-in 00:00 UTC is two hours later.
    const penalties = [penalty("2027-04-07T00:00:00+02:00", "2027-04-10T00:00:00+02:00", usd(12_000))];
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-09T23:00:00Z"))).toEqual({ kind: "charge", minor: 12_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-10T00:00:00Z"))).toEqual({ kind: "stay_started" });
  });

  it("a window of no length (start = end) charges at any time after it, and is free before it", () => {
    const penalties = [penalty("2027-04-07T11:59:00.000-08:00", "2027-04-07T11:59:00.000-08:00", usd(1_000))];
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-07T19:00:00Z"))).toEqual({ kind: "charge", minor: 0 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-07T20:00:00Z"))).toEqual({ kind: "charge", minor: 1_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-09T12:00:00Z"))).toEqual({ kind: "charge", minor: 1_000 });
  });

  it("a gap between a 10% window and a 100% window charges the 10%, never nothing", () => {
    const penalties = [
      penalty("2027-04-01T00:00:00Z", "2027-04-05T00:00:00Z", { percent: "10%" }),
      penalty("2027-04-06T00:00:00Z", "2027-04-10T00:00:00Z", { percent: "100%" }),
    ];
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-05T12:00:00Z"))).toEqual({ kind: "charge", minor: 5_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-07T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
  });

  it("in a gap after a window whose charge cannot be worked out: unknown (support), never free", () => {
    const penalties = [
      penalty("2027-04-01T00:00:00Z", "2027-04-05T00:00:00Z", { nights: 1 }),
      penalty("2027-04-06T00:00:00Z", "2027-04-10T00:00:00Z", { percent: "100%" }),
    ];
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-05T12:00:00Z"))).toEqual({ kind: "unknown" });
    // While the 100% window applies, its own charge is known.
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-07T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
  });

  it("back-to-back windows: each applies in its own time, free before the first, the stay started after the last", () => {
    const penalties = [
      penalty("2027-04-03T00:00:00Z", "2027-04-07T00:00:00Z", usd(10_000)),
      penalty("2027-04-07T00:00:00Z", "2027-04-10T23:59:00Z", { percent: "100%" }),
    ];
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-02T12:00:00Z"))).toEqual({ kind: "charge", minor: 0 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "charge", minor: 10_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-07T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-10T12:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
    expect(cancelChargeAt({ ...base, penalties }, at("2027-04-11T00:00:00Z"))).toEqual({ kind: "stay_started" });
  });

  it("a refundable rate with no penalties at all is free until check-in", () => {
    expect(cancelChargeAt({ ...base, penalties: [] }, at("2027-04-09T12:00:00Z"))).toEqual({ kind: "charge", minor: 0 });
    expect(cancelChargeAt({ ...base, penalties: [] }, at("2027-04-10T00:00:00Z"))).toEqual({ kind: "stay_started" });
  });
});

// Our request reaches the supplier a little after the agent's click, so every penalty counts as
// starting 10 minutes before the supplier's own time.
describe("cancelChargeAt: the safety margin", () => {
  const penalties = [
    penalty("2027-04-07T00:00:00Z", "2027-04-08T00:00:00Z", { amount: { minor: 12_000, currency: "USD" } }),
    penalty("2027-04-08T00:00:00Z", "2027-04-10T23:59:00Z", { percent: "100%" }),
  ];
  const before = (iso: string, ms: number) => new Date(Date.parse(iso) - ms);

  it("is 10 minutes", () => {
    expect(CANCEL_MARGIN_MS).toBe(10 * 60_000);
  });

  it("free only until 10 minutes before the first penalty", () => {
    expect(cancelChargeAt({ ...base, penalties }, before("2027-04-07T00:00:00Z", CANCEL_MARGIN_MS + 1))).toEqual({ kind: "charge", minor: 0 });
    expect(cancelChargeAt({ ...base, penalties }, before("2027-04-07T00:00:00Z", CANCEL_MARGIN_MS))).toEqual({ kind: "charge", minor: 12_000 });
  });

  it("the higher charge applies from 10 minutes before its window", () => {
    expect(cancelChargeAt({ ...base, penalties }, before("2027-04-08T00:00:00Z", CANCEL_MARGIN_MS + 1))).toEqual({ kind: "charge", minor: 12_000 });
    expect(cancelChargeAt({ ...base, penalties }, before("2027-04-08T00:00:00Z", CANCEL_MARGIN_MS))).toEqual({ kind: "charge", minor: 50_000 });
  });
});

// Plan 10: a booking of several rooms is charged room by room, from each room's own total.
describe("cancelChargeForRooms", () => {
  const rate = { refundable: base.refundable, currency: base.currency, checkin: base.checkin };
  const fixed = [penalty("2027-04-07T00:00:00+02:00", "2027-04-10T23:59:00+02:00", { amount: { minor: 12_000, currency: "USD" } })];

  it("each room is charged the penalty, at most its own total, and the charges are added", () => {
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [25_000, 25_000] }, at("2027-04-08T12:00:00Z"))).toEqual({ kind: "charge", minor: 24_000 });
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [10_000, 40_000] }, at("2027-04-08T12:00:00Z"))).toEqual({ kind: "charge", minor: 22_000 });
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [25_000, 25_000] }, at("2027-04-05T12:00:00Z"))).toEqual({ kind: "charge", minor: 0 });
  });

  it("one room is exactly the one-room charge", () => {
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [50_000] }, at("2027-04-08T12:00:00Z"))).toEqual(cancelChargeAt({ ...base, penalties: fixed }, at("2027-04-08T12:00:00Z")));
  });

  it("a percentage is exact on every room's own total, or the whole charge is unknown", () => {
    const half = [penalty("2027-04-01T00:00:00Z", "2027-04-11T00:00:00Z", { percent: "50%" })];
    expect(cancelChargeForRooms({ ...rate, penalties: half, roomTotalsMinor: [30_000, 20_000] }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "charge", minor: 25_000 });
    // 50,000 in all would divide, but room 2's 20,001 does not: never rounded.
    expect(cancelChargeForRooms({ ...rate, penalties: half, roomTotalsMinor: [29_999, 20_001] }, at("2027-04-05T00:00:00Z"))).toEqual({ kind: "unknown" });
  });

  it("non-refundable: every room's total; after check-in: the stay started; no rooms: unknown", () => {
    expect(cancelChargeForRooms({ ...rate, refundable: false, penalties: [], roomTotalsMinor: [30_000, 20_000] }, at("2027-04-01T00:00:00Z"))).toEqual({ kind: "charge", minor: 50_000 });
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [30_000, 20_000] }, at("2027-04-11T12:00:00Z"))).toEqual({ kind: "stay_started" });
    expect(cancelChargeForRooms({ ...rate, penalties: fixed, roomTotalsMinor: [] }, at("2027-04-05T12:00:00Z"))).toEqual({ kind: "unknown" });
  });
});

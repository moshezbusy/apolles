import { describe, expect, it } from "vitest";
import { cancelChargeAt } from "./cancel-charge";

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

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { agencyReport, reportCsv, reportPeriod } from "@/server/reports";
import { credit } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";

const NOW = new Date("2027-03-20T12:00:00.000Z");
let n = 0;

async function booking(agencyId: string, data: Record<string, unknown>) {
  n += 1;
  return db.booking.create({
    data: {
      reference: `APL-T${String(n).padStart(7, "0")}`,
      agencyId,
      userId: `u-${agencyId}`,
      status: "CONFIRMED",
      propertyId: "1",
      hotelName: "Hotel One",
      hotelCity: "Cancun",
      roomId: "r",
      roomName: "Room",
      rateId: "x",
      bedGroupId: "b",
      bedDescription: "1 King Bed",
      adults: 2,
      childAges: [],
      leadGivenName: "Dana",
      leadFamilyName: "Levi",
      leadEmail: "dana@example.com",
      leadPhone: "+972 501234567",
      guests: [],
      refundable: true,
      totalMinor: 100_000,
      chargedMinor: 100_000,
      currency: "USD",
      price: {},
      cancelPenalties: [],
      nonrefundableDateRanges: [],
      priceCheckToken: "tok",
      createdAt: new Date(),
      checkin: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      checkout: new Date(Date.now() + 22 * 86_400_000).toISOString().slice(0, 10),
      ...data,
    },
  });
}

beforeEach(async () => {
  await resetTestDb();
  n = 0;
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
});

describe("report periods", () => {
  it("this month, last 7 days, last month, this year, a custom range; each with the period before", () => {
    expect(reportPeriod({ range: "month" }, NOW)).toMatchObject({ from: "2027-03-01", to: "2027-03-31", prevFrom: "2027-02-01", prevTo: "2027-02-20" });
    expect(reportPeriod({ range: "7d" }, NOW)).toMatchObject({ from: "2027-03-14", to: "2027-03-20", prevFrom: "2027-03-07", prevTo: "2027-03-13" });
    expect(reportPeriod({ range: "last_month" }, NOW)).toMatchObject({ from: "2027-02-01", to: "2027-02-28", prevFrom: "2027-01-01", prevTo: "2027-01-31" });
    expect(reportPeriod({ range: "year" }, NOW)).toMatchObject({ from: "2027-01-01", to: "2027-12-31", prevFrom: "2026-01-01", prevTo: "2026-03-20" });
    // The 31st compared with a shorter month: up to that month's last day.
    expect(reportPeriod({ range: "month" }, new Date("2027-03-31T10:00:00Z"))).toMatchObject({ prevFrom: "2027-02-01", prevTo: "2027-02-28" });
    expect(reportPeriod({ range: "custom", from: "2027-02-10", to: "2027-02-19" }, NOW)).toMatchObject({ from: "2027-02-10", to: "2027-02-19", prevFrom: "2027-01-31", prevTo: "2027-02-09" });
    // Bad or too long custom ranges fall back to this month.
    expect(reportPeriod({ range: "custom", from: "2025-01-01", to: "2027-02-19" }, NOW)).toMatchObject({ range: "month" });
    expect(reportPeriod({ range: "custom", from: "2027-02-30", to: "2027-03-01" }, NOW)).toMatchObject({ range: "month" });
    expect(reportPeriod({ range: "nope" }, NOW)).toMatchObject({ range: "month" });
  });
});

describe("agency report (screen 19)", () => {
  // The real clock: ledger entries get the database time.
  const now = new Date();
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  // The 1st of last month: inside "the same days before" whatever today is.
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 1));

  async function seed() {
    // This month, agency A:
    await booking("A", { sellMarkupType: "PERCENT", sellMarkupValue: 1000 }); // sale 110,000, profit 10,000
    await booking("A", { sellMarkupType: "FIXED", sellMarkupValue: 5_000, chargedMinor: 50_000, totalMinor: 50_000, hotelName: "Hotel Two", propertyId: "2", hotelCity: "Tulum" }); // 55,000 / 5,000
    await booking("A", { chargedMinor: 30_000, totalMinor: 30_000 }); // no selling price: 30,000 / 0
    await booking("A", { status: "CANCELLED", sellMarkupType: "FIXED", sellMarkupValue: 9_000, cancelChargeMinor: 5_000 }); // not a sale; its charge was paid
    await booking("A", { status: "PENDING_CONFIRMATION", chargedMinor: 20_000, totalMinor: 20_000, sellMarkupType: "FIXED", sellMarkupValue: 1_000 }); // 21,000 / 1,000
    await booking("A", { checkin: day(-2), checkout: day(2) }); // in stay, no price
    await booking("A", { checkin: day(-12), checkout: day(-10) }); // completed, no price
    await booking("A", { status: "DRAFT" }); // not a booking
    await booking("A", { status: "FAILED" }); // not a booking
    // Last month, agency A (for the comparison):
    await booking("A", { createdAt: lastMonth, chargedMinor: 100_000 });
    // Agency B, this month: never in A's report.
    await booking("B", { chargedMinor: 999_999, totalMinor: 999_999 });
    await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 500_000, reason: "test", idempotencyKey: "t1" });
    await credit({ agencyId: "A", type: "REFUND", amountCents: 12_345, reason: "refund", idempotencyKey: "r1", bookingRef: "APL-T0000004" });
  }

  it("sums the agency's own bookings of the period: sales, paid, profit, margin, statuses", async () => {
    await seed();
    const r = await agencyReport("A", reportPeriod({ range: "month" }, now), now);
    // Sales: 110,000 + 55,000 + 30,000 + 21,000 + 100,000 + 100,000 = 416,000.
    expect(r.totals).toEqual({
      bookings: 7,
      grossSalesMinor: 416_000,
      paidMinor: 385_000, // confirmed 380,000 + the cancellation charge 5,000 (the pending 20,000 is only held)
      profitMinor: 16_000,
      marginBp: 385, // 16,000 / 416,000 = 3.85%
      withoutPriceCount: 3,
      previousGrossSalesMinor: 100_000,
      changeBp: 31_600, // +316%
    });
    expect(r.status).toEqual({ vouchered: 3, pending: 1, inStay: 1, completed: 1, cancelled: 1 });
    expect(r.metrics).toEqual({ avgValueMinor: 69_333, avgProfitMinor: 2_667, marginBp: 385, cancellationRateBp: 1_429 });
    expect(r.topDestinations[0]).toEqual({ name: "Cancun", bookings: 5, salesMinor: 361_000, profitMinor: 11_000 });
    expect(r.topHotels.map((h) => h.name)).toEqual(["Hotel One", "Hotel Two"]);
    expect(r.recent).toHaveLength(5);
    expect(r.weekly.reduce((sum, w) => sum + w.salesMinor, 0)).toBe(416_000);
    expect(r.balance).toMatchObject({ topupsCents: 500_000, topupCount: 1, refundsCents: 12_345, refundCount: 1 });
    expect(JSON.stringify(r)).not.toContain("999999");
  });

  it("the CSV has the period's bookings with sale, net and profit; formulas are neutralised", async () => {
    await seed();
    await booking("A", { hotelName: "=HYPERLINK(1)" });
    const csv = await reportCsv("A", reportPeriod({ range: "month" }, now));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe('Reference,Booked at (UTC),Status,Hotel,City,Lead guest,Check-in,Check-out,Net (USD),Selling price (USD),Profit (USD)');
    expect(lines).toHaveLength(1 + 8); // 7 bookings this month (no drafts or failed) + the new one
    expect(csv).toContain("\"'=HYPERLINK(1)\"");
    expect(csv).toContain(",1000.00,1100.00,100.00");
    expect(csv).not.toContain("9999.99");
  });
});

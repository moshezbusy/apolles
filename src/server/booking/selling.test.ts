import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { bookingSale, setSellingPrice } from "./selling";

async function booking(agencyId: string, data: Record<string, unknown> = {}) {
  return db.booking.create({
    data: {
      reference: `APL-${agencyId}${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      agencyId,
      userId: `u-${agencyId}`,
      status: "CONFIRMED",
      propertyId: "1",
      hotelName: "H",
      hotelCity: "C",
      roomId: "r",
      roomName: "Room",
      rateId: "x",
      bedGroupId: "b",
      bedDescription: "1 King Bed",
      checkin: "2027-04-10",
      checkout: "2027-04-12",
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
      ...data,
    },
  });
}

beforeEach(async () => {
  await resetTestDb();
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
});

describe("selling price of a booking (screens 11, 12)", () => {
  it("is the charged total plus the markup, rounded once; without one, the net and no profit", () => {
    const base = { status: "CONFIRMED" as const, totalMinor: 100_001, chargedMinor: 99_999, sellMarkupType: null, sellMarkupValue: null };
    expect(bookingSale(base)).toEqual({ netMinor: 99_999, saleMinor: 99_999, profitMinor: 0, priced: false });
    expect(bookingSale({ ...base, sellMarkupType: "PERCENT", sellMarkupValue: 1250 })).toEqual({ netMinor: 99_999, saleMinor: 112_499, profitMinor: 12_500, priced: true });
    expect(bookingSale({ ...base, sellMarkupType: "FIXED", sellMarkupValue: 4_000 })).toMatchObject({ saleMinor: 103_999, profitMinor: 4_000 });
    // A draft has no charge yet: the checked total is the net.
    expect(bookingSale({ ...base, status: "DRAFT", chargedMinor: null, sellMarkupType: "FIXED", sellMarkupValue: 100 })).toMatchObject({ netMinor: 100_001, saleMinor: 100_101 });
    // Cancelled: no sale and no profit.
    expect(bookingSale({ ...base, status: "CANCELLED", sellMarkupType: "FIXED", sellMarkupValue: 100 })).toEqual({ netMinor: 0, saleMinor: 0, profitMinor: 0, priced: true });
  });

  it("is set and cleared for the agency's own booking only, with an audit row, never changing the charge", async () => {
    const b = await booking("A");
    expect(await setSellingPrice("u-A", "A", b.id, { markupType: "PERCENT", markupValue: "10" })).toEqual({ ok: true });
    expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ sellMarkupType: "PERCENT", sellMarkupValue: 1000, totalMinor: 100_000, chargedMinor: 100_000 });
    expect(await setSellingPrice("u-B", "B", b.id, { markupType: "FIXED", markupValue: "1" })).toEqual({ ok: false, error: "This booking was not found." });
    expect((await setSellingPrice("u-A", "A", b.id, { markupType: "PERCENT", markupValue: "abc" })).ok).toBe(false);
    expect(await setSellingPrice("u-A", "A", b.id, { markupType: "", markupValue: "" })).toEqual({ ok: true });
    expect(await db.booking.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ sellMarkupType: null, sellMarkupValue: null });
    expect(await db.auditLog.count({ where: { action: "booking.selling-price", targetId: b.id } })).toBe(2);
  });
});

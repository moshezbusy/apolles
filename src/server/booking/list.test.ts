import { beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { bookingsCsv, listBookings } from "./list";

const NOW = new Date("2027-03-01T10:00:00.000Z");

async function make(agencyId: string, n: number, status: BookingStatus, checkin: string, extra: { hotelName?: string; leadFamilyName?: string } = {}) {
  return db.booking.create({
    data: {
      reference: `APL-${agencyId}${String(n).padStart(7, "0")}`,
      agencyId,
      userId: `u-${agencyId}`,
      status,
      propertyId: "1",
      hotelName: extra.hotelName ?? "Hotel Lumiere",
      hotelCity: "Paris",
      roomId: "r",
      roomName: "Room",
      rateId: "x",
      bedGroupId: "b",
      bedDescription: "1 King Bed",
      checkin,
      checkout: "2027-12-31",
      adults: 2,
      childAges: [],
      leadGivenName: "Dana",
      leadFamilyName: extra.leadFamilyName ?? "Levi",
      leadEmail: "dana@example.com",
      leadPhone: "+972 501234567",
      guests: [],
      refundable: true,
      totalMinor: 10_000 + n,
      currency: "USD",
      price: {},
      cancelPenalties: [],
      nonrefundableDateRanges: [],
      priceCheckToken: "tok-a1",
      createdAt: new Date(NOW.getTime() - n * 60_000),
    },
  });
}

describe("listBookings", () => {
  beforeEach(async () => {
    await resetTestDb();
    for (const id of ["A", "B"]) {
      await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
      await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
    }
    await make("A", 1, "CONFIRMED", "2027-04-10");
    await make("A", 2, "CONFIRMED", "2027-01-10"); // past stay
    await make("A", 3, "PENDING_CONFIRMATION", "2027-05-01", { hotelName: "Maison Rivoli" });
    await make("A", 4, "CANCELLED", "2027-06-01", { leadFamilyName: "Cohen" });
    await make("A", 5, "DRAFT", "2027-06-01");
    await make("B", 6, "CONFIRMED", "2027-04-10");
  });

  it("lists only the agency's bookings, newest first, never drafts", async () => {
    const page = await listBookings("A", { tab: "all" }, NOW);
    expect(page.rows.map((r) => r.reference)).toEqual(["APL-A0000001", "APL-A0000002", "APL-A0000003", "APL-A0000004"]);
  });

  it("tabs: upcoming (confirmed, stay not started), pending, cancelled", async () => {
    expect((await listBookings("A", { tab: "upcoming" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000001"]);
    expect((await listBookings("A", { tab: "pending" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000003"]);
    expect((await listBookings("A", { tab: "cancelled" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000004"]);
  });

  it("search by reference, hotel or guest name, case-insensitive, wildcards taken literally", async () => {
    expect((await listBookings("A", { tab: "all", q: "rivoli" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000003"]);
    expect((await listBookings("A", { tab: "all", q: "cohen" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000004"]);
    expect((await listBookings("A", { tab: "all", q: "a0000002" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000002"]);
    expect((await listBookings("A", { tab: "all", q: "%" }, NOW)).rows).toEqual([]);
    expect((await listBookings("A", { tab: "all", q: "APL-B0000006" }, NOW)).rows).toEqual([]);
  });

  it("pages with a cursor", async () => {
    const first = await listBookings("A", { tab: "all", take: 2 }, NOW);
    expect(first.rows).toHaveLength(2);
    const second = await listBookings("A", { tab: "all", take: 2, cursor: first.nextCursor! }, NOW);
    expect(second.rows.map((r) => r.reference)).toEqual(["APL-A0000003", "APL-A0000004"]);
    expect(second.nextCursor).toBeNull();
  });

  it("CSV: a header, one line per booking, amounts as decimals, and cells that start a formula are neutralised", async () => {
    await make("A", 7, "CONFIRMED", "2027-04-10", { hotelName: "=HYPERLINK(\"x\")", leadFamilyName: "O'Brien, Jr" });
    const csv = await bookingsCsv("A", { tab: "all" }, NOW);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Reference,Status,Hotel,City,Lead guest,Check-in,Check-out,Total,Currency,Booked at (UTC)");
    expect(lines).toHaveLength(6);
    const row = lines.find((l) => l.startsWith("APL-A0000007"))!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(`"Dana O'Brien, Jr"`);
    expect(row).toContain(",100.07,USD,");
  });
});

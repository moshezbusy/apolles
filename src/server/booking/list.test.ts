import { beforeEach, describe, expect, it } from "vitest";
import type { BookingStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { bookingIdsByReference, bookingsCsv, listBookings } from "./list";

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
    // Every fixture checks out on 2027-12-31: booking 2 (checked in 2027-01-10) is in stay now.
    expect((await listBookings("A", { tab: "in_stay" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000002"]);
    expect((await listBookings("A", { tab: "completed" }, NOW)).rows).toEqual([]);
    expect((await listBookings("A", { tab: "completed" }, new Date("2028-01-05T10:00:00Z"))).rows.map((r) => r.reference)).toEqual(["APL-A0000001", "APL-A0000002"]);
  });

  it("search by reference, hotel or guest name, case-insensitive, wildcards taken literally", async () => {
    expect((await listBookings("A", { tab: "all", q: "rivoli" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000003"]);
    expect((await listBookings("A", { tab: "all", q: "cohen" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000004"]);
    expect((await listBookings("A", { tab: "all", q: "a0000002" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000002"]);
    expect((await listBookings("A", { tab: "all", q: "%" }, NOW)).rows).toEqual([]);
    expect((await listBookings("A", { tab: "all", q: "APL-B0000006" }, NOW)).rows).toEqual([]);
  });

  it("not confirmed and not finished tabs; drafts only in Not finished, never another agency's", async () => {
    await make("A", 9, "FAILED", "2027-04-10");
    expect((await listBookings("A", { tab: "failed" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000009"]);
    expect((await listBookings("A", { tab: "not_finished" }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000005"]);
    expect((await listBookings("B", { tab: "not_finished" }, NOW)).rows).toEqual([]);
  });

  it("filters by booked date and check-in date, with the total count of the filtered list", async () => {
    // Booking n was made n minutes before NOW (2027-03-01 10:00 UTC); move two to other days.
    await db.booking.update({ where: { reference: "APL-A0000002" }, data: { createdAt: new Date("2027-02-10T23:30:00Z") } });
    await db.booking.update({ where: { reference: "APL-A0000003" }, data: { createdAt: new Date("2027-01-05T08:00:00Z") } });
    const booked = await listBookings("A", { tab: "all", bookedFrom: "2027-02-10", bookedTo: "2027-02-10" }, NOW);
    expect(booked.rows.map((r) => r.reference)).toEqual(["APL-A0000002"]);
    expect(booked.total).toBe(1);
    const checkin = await listBookings("A", { tab: "all", checkinFrom: "2027-04-01", checkinTo: "2027-05-31" }, NOW);
    expect(checkin.rows.map((r) => r.reference)).toEqual(["APL-A0000001", "APL-A0000003"]);
    expect((await listBookings("A", { tab: "all" }, NOW)).total).toBe(4);
    // A date that is not a day is ignored, never an error.
    expect((await listBookings("A", { tab: "all", bookedFrom: "2027-02-31x" }, NOW)).total).toBe(4);
  });

  it("without a selling price: live bookings with no selling price, as the reports count them", async () => {
    await db.booking.update({ where: { reference: "APL-A0000002" }, data: { sellMarkupType: "PERCENT", sellMarkupValue: 1_000 } });
    expect((await listBookings("A", { tab: "all", unpriced: true }, NOW)).rows.map((r) => r.reference)).toEqual(["APL-A0000001", "APL-A0000003"]);
  });

  it("booking ids by reference: the agency's own only", async () => {
    const ids = await bookingIdsByReference("A", ["APL-A0000001", "APL-B0000006", "nope"]);
    expect([...ids.keys()]).toEqual(["APL-A0000001"]);
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
    // Plan 10: "Rooms" is appended, so the earlier columns keep their places.
    expect(lines[0]).toBe("Reference,Status,Hotel,City,Lead guest,Check-in,Check-out,Total,Currency,Booked at (UTC),Rooms");
    expect(lines).toHaveLength(6);
    const row = lines.find((l) => l.startsWith("APL-A0000007"))!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(`"Dana O'Brien, Jr"`);
    expect(row).toContain(",100.07,USD,");
    expect(row.endsWith(",1")).toBe(true);
  });

  it("CSV: starts with the UTF-8 mark, so Excel reads names in any script", async () => {
    await make("A", 8, "CONFIRMED", "2027-04-10", { hotelName: "מלון הים", leadFamilyName: "Müller" });
    const csv = await bookingsCsv("A", { tab: "all" }, NOW);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith("Reference,Status,")).toBe(true);
    expect(csv.indexOf("\uFEFF", 1)).toBe(-1); // once, at the very start
    expect(csv).toContain(`"מלון הים"`);
    expect(csv).toContain(`"Dana Müller"`);
  });

  it("CSV: an export that was cut says so in a last row, with how many bookings are missing; a whole export has no such row", async () => {
    const whole = (await bookingsCsv("A", { tab: "all" }, NOW)).trim().split("\r\n");
    expect(whole).toHaveLength(5); // the header and 4 bookings
    expect(whole.join("\n")).not.toContain("not in this file");
    const cut = (await bookingsCsv("A", { tab: "all" }, NOW, { maxRows: 3 })).trim().split("\r\n");
    expect(cut).toHaveLength(5); // the header, 3 bookings, the notice
    expect(cut.slice(1, 4).map((l) => l.split(",")[0])).toEqual(["APL-A0000001", "APL-A0000002", "APL-A0000003"]);
    expect(cut[4]).toBe(`"This export was cut at 3 rows: 1 more booking is not in this file. Narrow the list with the tabs or the search box, then export again."`);
    const more = (await bookingsCsv("A", { tab: "all" }, NOW, { maxRows: 2 })).trim().split("\r\n");
    expect(more[3]).toContain("cut at 2 rows: 2 more bookings are not in this file");
    // The count follows the same tab and search, and the agency: another agency's bookings never count.
    const confirmed = (await bookingsCsv("A", { tab: "upcoming" }, NOW, { maxRows: 1 })).trim().split("\r\n");
    expect(confirmed).toHaveLength(2);
  });

  it("several rooms (plan 10): each row has its number of rooms, in the list and the CSV", async () => {
    const two = await db.booking.findUniqueOrThrow({ where: { reference: "APL-A0000001" } });
    await db.bookingRoom.createMany({
      data: [0, 1].map((index) => ({ bookingId: two.id, index, adults: 1, childAges: [], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 5_000, price: {} })),
    });
    const one = await db.booking.findUniqueOrThrow({ where: { reference: "APL-A0000002" } });
    await db.bookingRoom.create({ data: { bookingId: one.id, index: 0, adults: 2, childAges: [], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 10_002, price: {} } });
    const rows = (await listBookings("A", { tab: "all" }, NOW)).rows;
    // A booking made before its rooms were stored (none here) counts as one room.
    expect(rows.map((r) => [r.reference, r.roomCount])).toEqual([["APL-A0000001", 2], ["APL-A0000002", 1], ["APL-A0000003", 1], ["APL-A0000004", 1]]);
    const lines = (await bookingsCsv("A", { tab: "all" }, NOW)).trim().split("\r\n");
    expect(lines.find((l) => l.startsWith("APL-A0000001"))!.endsWith(",2")).toBe(true);
    expect(lines.find((l) => l.startsWith("APL-A0000002"))!.endsWith(",1")).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { adminHeaderCounts, cleanupSupplierLog, getBookingForAdmin, listAllBookings, listSupplierLog } from "./bookings";

const NOW = new Date("2027-03-01T10:00:00.000Z");

async function booking(agencyId: string, reference: string, status: "CONFIRMED" | "DRAFT") {
  return db.booking.create({
    data: {
      reference, agencyId, userId: `u-${agencyId}`, status, propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r", roomName: "Room", rateId: "x",
      bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi",
      leadEmail: "d@e.co", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 10_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [],
      priceCheckToken: "tok-a1", supplierItineraryId: status === "CONFIRMED" ? `IT-${reference}` : null,
    },
  });
}

describe("admin bookings and supplier log", () => {
  beforeEach(async () => {
    await resetTestDb();
    for (const id of ["A", "B"]) {
      await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
      await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
    }
    await booking("A", "APL-AAAAAAA1", "CONFIRMED");
    await booking("B", "APL-BBBBBBB1", "CONFIRMED");
    await booking("B", "APL-BBBBBBB2", "DRAFT");
  });

  it("lists every agency's bookings (drafts excluded), searchable by agency, reference or supplier itinerary", async () => {
    expect((await listAllBookings({})).rows.map((r) => r.reference).sort()).toEqual(["APL-AAAAAAA1", "APL-BBBBBBB1"]);
    expect((await listAllBookings({ q: "agency b" })).rows.map((r) => r.reference)).toEqual(["APL-BBBBBBB1"]);
    expect((await listAllBookings({ q: "IT-APL-AAAAAAA1" })).rows.map((r) => r.reference)).toEqual(["APL-AAAAAAA1"]);
    expect((await listAllBookings({ q: "%" })).rows).toEqual([]);
  });

  it("one booking with its agency, agent and the supplier's itinerary id (ER1)", async () => {
    const b = await db.booking.findUniqueOrThrow({ where: { reference: "APL-AAAAAAA1" } });
    expect(await getBookingForAdmin(b.id)).toMatchObject({ supplierItineraryId: "IT-APL-AAAAAAA1", agency: { name: "Agency A" }, user: { email: "A@t.local" } });
    expect(await getBookingForAdmin("x".repeat(65))).toBeNull();
  });

  it("one booking's rooms in room order (plan 10), never with the supplier's cancel link", async () => {
    const b = await db.booking.findUniqueOrThrow({ where: { reference: "APL-AAAAAAA1" } });
    await db.bookingRoom.createMany({
      data: [1, 0].map((index) => ({ bookingId: b.id, index, adults: 1, childAges: [], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 5_000, price: {}, supplierRoomId: `room-${index + 1}`, cancelLink: `secret-cancel-${index}` })),
    });
    const found = await getBookingForAdmin(b.id);
    expect(found!.rooms.map((r) => r.supplierRoomId)).toEqual(["room-1", "room-2"]);
    expect(found!.rooms[0]).not.toHaveProperty("cancelLink");
    expect(JSON.stringify(found)).not.toContain("secret-cancel");
  });

  it("supplier log: newest first, filter by our reference; rows older than 90 days are deleted", async () => {
    await db.supplierCallLog.create({ data: { supplier: "expedia", method: "POST", path: "/itineraries", status: 201, durationMs: 900, affiliateReferenceId: "APL-AAAAAAA1", createdAt: new Date(NOW.getTime() - 1000) } });
    await db.supplierCallLog.create({ data: { supplier: "expedia", method: "GET", path: "/regions", status: 200, durationMs: 100, createdAt: new Date(NOW.getTime() - 91 * 86_400_000) } });
    expect((await listSupplierLog({})).rows.map((r) => r.path)).toEqual(["/itineraries", "/regions"]);
    expect((await listSupplierLog({ reference: "APL-AAAAAAA1" })).rows).toHaveLength(1);
    expect(await cleanupSupplierLog(NOW)).toBe(1);
    expect(await db.supplierCallLog.count()).toBe(1);
  });

  it("filters: status, agency and booking date range; needs attention comes first in its own list", async () => {
    const a = await db.booking.findUniqueOrThrow({ where: { reference: "APL-AAAAAAA1" } });
    await db.booking.update({ where: { reference: "APL-BBBBBBB1" }, data: { status: "PENDING_CONFIRMATION", createdAt: new Date("2027-02-01T12:00:00Z") } });
    await db.booking.update({ where: { id: a.id }, data: { needsAttention: true, createdAt: new Date("2027-02-20T12:00:00Z") } });

    const all = await listAllBookings({});
    expect(all.attention.map((r) => r.reference)).toEqual(["APL-AAAAAAA1"]);
    expect(all.rows.map((r) => r.reference)).toEqual(["APL-BBBBBBB1"]);
    expect((await listAllBookings({ needsAttention: true })).rows.map((r) => r.reference)).toEqual(["APL-AAAAAAA1"]);
    expect((await listAllBookings({ status: "PENDING_CONFIRMATION" })).rows.map((r) => r.reference)).toEqual(["APL-BBBBBBB1"]);
    expect((await listAllBookings({ agencyId: "B" })).rows.map((r) => r.reference)).toEqual(["APL-BBBBBBB1"]);
    expect((await listAllBookings({ agencyId: "B" })).attention).toEqual([]);
    const feb = await listAllBookings({ from: "2027-02-01", to: "2027-02-01" });
    expect([...feb.attention, ...feb.rows].map((r) => r.reference)).toEqual(["APL-BBBBBBB1"]);
    const later = await listAllBookings({ from: "2027-02-02" });
    expect([...later.attention, ...later.rows].map((r) => r.reference)).toEqual(["APL-AAAAAAA1"]);
    // A date that is not a real day is ignored, never an error.
    expect((await listAllBookings({ from: "2027-02-31" })).rows).toHaveLength(1);
  });

  it("header counters: applications waiting, bookings needing attention, open change requests", async () => {
    expect(await adminHeaderCounts()).toEqual({ applications: 0, attention: 0, changeRequests: 0 });
    await db.booking.update({ where: { reference: "APL-AAAAAAA1" }, data: { needsAttention: true } });
    await db.agencyApplication.create({ data: { agencyName: "New", contactName: "N", email: "n@t.local", phone: "1", country: "IL", website: "https://n.example" } });
    await db.agencyApplication.create({ data: { agencyName: "Old", contactName: "O", email: "o@t.local", phone: "1", country: "IL", website: "https://o.example", status: "REJECTED" } });
    expect(await adminHeaderCounts()).toEqual({ applications: 1, attention: 1, changeRequests: 0 });
  });

  it("supplier log filters: errors only, call type and day range", async () => {
    const at = (day: string) => new Date(`${day}T10:00:00Z`);
    await db.supplierCallLog.createMany({
      data: [
        { supplier: "expedia", method: "POST", path: "/itineraries", status: 201, durationMs: 900, createdAt: at("2027-02-10") },
        { supplier: "expedia", method: "GET", path: "/itineraries/1?token=x", status: 500, durationMs: 100, createdAt: at("2027-02-11") },
        { supplier: "expedia", method: "GET", path: "/properties/availability?x=1", status: null, error: "timeout", durationMs: 100, createdAt: at("2027-02-12") },
        { supplier: "expedia", method: "DELETE", path: "/itineraries/1/rooms/2", status: 204, durationMs: 100, createdAt: at("2027-02-13") },
        { supplier: "expedia", method: "GET", path: "/properties/11/rooms/r/rates/x?token=y", status: 200, durationMs: 100, createdAt: at("2027-02-14") },
      ],
    });
    const paths = async (opts: Parameters<typeof listSupplierLog>[0]) => (await listSupplierLog(opts)).rows.map((r) => r.path);
    expect(await paths({ errorsOnly: true })).toEqual(["/properties/availability?x=1", "/itineraries/1?token=x"]);
    expect(await paths({ type: "book" })).toEqual(["/itineraries"]);
    expect(await paths({ type: "retrieve" })).toEqual(["/itineraries/1?token=x"]);
    expect(await paths({ type: "cancel" })).toEqual(["/itineraries/1/rooms/2"]);
    expect(await paths({ type: "price-check" })).toEqual(["/properties/11/rooms/r/rates/x?token=y"]);
    expect(await paths({ type: "search" })).toEqual(["/properties/availability?x=1"]);
    expect(await paths({ from: "2027-02-11", to: "2027-02-12" })).toEqual(["/properties/availability?x=1", "/itineraries/1?token=x"]);
  });
});

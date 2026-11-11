import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { cleanupSupplierLog, getBookingForAdmin, listAllBookings, listSupplierLog } from "./bookings";

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

  it("supplier log: newest first, filter by our reference; rows older than 90 days are deleted", async () => {
    await db.supplierCallLog.create({ data: { supplier: "expedia", method: "POST", path: "/itineraries", status: 201, durationMs: 900, affiliateReferenceId: "APL-AAAAAAA1", createdAt: new Date(NOW.getTime() - 1000) } });
    await db.supplierCallLog.create({ data: { supplier: "expedia", method: "GET", path: "/regions", status: 200, durationMs: 100, createdAt: new Date(NOW.getTime() - 91 * 86_400_000) } });
    expect((await listSupplierLog({})).rows.map((r) => r.path)).toEqual(["/itineraries", "/regions"]);
    expect((await listSupplierLog({ reference: "APL-AAAAAAA1" })).rows).toHaveLength(1);
    expect(await cleanupSupplierLog(NOW)).toBe(1);
    expect(await db.supplierCallLog.count()).toBe(1);
  });
});

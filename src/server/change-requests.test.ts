import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { ChangeRequestNotAllowed, countOpenChangeRequests, createChangeRequest, listChangeRequests, listChangeRequestsForBooking, markChangeRequestDone } from "./change-requests";

async function booking(agencyId: string, id: string, status: "CONFIRMED" | "CANCELLED" = "CONFIRMED") {
  return db.booking.create({
    data: {
      id, reference: `APL-${id.toUpperCase().padEnd(8, "X")}`, agencyId, userId: `u-${agencyId}`, status, propertyId: "1", hotelName: "Hotel", hotelCity: "Paris", roomId: "r", roomName: "Room", rateId: "x",
      bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi",
      leadEmail: "d@e.co", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 10_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok",
    },
  });
}

const refusal = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof ChangeRequestNotAllowed ? error.code : error));

describe("change requests", () => {
  beforeEach(async () => {
    await resetTestDb();
    for (const id of ["A", "B"]) {
      await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
      await db.user.create({ data: { id: `u-${id}`, email: `${id.toLowerCase()}@t.local`, name: id, role: "AGENT", agencyId: id } });
    }
    await db.user.create({ data: { id: "admin", email: "admin@t.local", name: "Admin", role: "ADMIN" } });
    await booking("A", "bka");
    await booking("B", "bkb");
  });

  it("saves the request, writes a trail row and an audit row, and queues one admin email", async () => {
    const { id } = await createChangeRequest("A", "u-A", "bka", "  Please change the lead guest to Avi Levi.\r\nThanks  ");
    expect(await db.changeRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ bookingId: "bka", agencyId: "A", authorUserId: "u-A", status: "OPEN", text: "Please change the lead guest to Avi Levi.\nThanks" });
    expect(await db.bookingEvent.count({ where: { bookingId: "bka", actorUserId: "u-A" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "booking.change-request", targetId: id } })).toBe(1);
    const jobs = await db.job.findMany({ where: { kind: "email.booking" } });
    expect(jobs.map((j) => j.payload)).toEqual([{ bookingId: "bka", event: "change_request" }]);
    expect(await listChangeRequestsForBooking("A", "bka")).toHaveLength(1);
    expect(await countOpenChangeRequests()).toBe(1);
  });

  it("scoped to the agency: another agency's booking, or a user of another agency, is not found", async () => {
    expect(await refusal(createChangeRequest("A", "u-A", "bkb", "Change it"))).toBe("not_found");
    expect(await refusal(createChangeRequest("A", "u-B", "bka", "Change it"))).toBe("not_found");
    expect(await refusal(createChangeRequest("A", "admin", "bka", "Change it"))).toBe("not_found");
    expect(await listChangeRequestsForBooking("B", "bka")).toEqual([]);
    expect(await db.changeRequest.count()).toBe(0);
  });

  it("text from 1 to 2000 characters; only for a booked or waiting booking; 10 an hour per agent", async () => {
    expect(await refusal(createChangeRequest("A", "u-A", "bka", "   "))).toBe("invalid");
    expect(await refusal(createChangeRequest("A", "u-A", "bka", "x".repeat(2001)))).toBe("invalid");
    expect(await refusal(createChangeRequest("A", "u-A", "bka", "x".repeat(2000)))).toBeNull();
    await booking("A", "bkc", "CANCELLED");
    expect(await refusal(createChangeRequest("A", "u-A", "bkc", "Change it"))).toBe("not_open");
    await db.user.create({ data: { id: "u-A2", email: "a2@t.local", name: "A2", role: "AGENT", agencyId: "A" } });
    await seedRateLimit("change-request:u-A2", 10, 60 * 60_000);
    expect(await refusal(createChangeRequest("A", "u-A2", "bka", "Change it"))).toBe("too_many");
  });

  it("the admin marks it done once, with a note; listed by status", async () => {
    const { id } = await createChangeRequest("A", "u-A", "bka", "Change the dates");
    await createChangeRequest("B", "u-B", "bkb", "Add a crib");
    expect((await listChangeRequests({ status: "OPEN" })).rows).toHaveLength(2);
    expect(await markChangeRequestDone("admin", id, "Changed at Expedia")).toBe("done");
    expect(await markChangeRequestDone("admin", id, "again")).toBe("already");
    expect(await markChangeRequestDone("admin", "nope", "")).toBe("not_found");
    expect(await db.changeRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DONE", doneById: "admin", adminNote: "Changed at Expedia" });
    expect((await listChangeRequests({ status: "OPEN" })).rows.map((r) => r.booking.id)).toEqual(["bkb"]);
    expect((await listChangeRequests({ bookingId: "bka" })).rows.map((r) => r.status)).toEqual(["DONE"]);
    expect(await db.auditLog.count({ where: { action: "change-request.done" } })).toBe(1);
    expect(await countOpenChangeRequests()).toBe(1);
  });
});

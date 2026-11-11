import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { BookingStateConflict, canTransition, transition } from "./states";

async function booking(status: "DRAFT" | "CONFIRMED" = "DRAFT") {
  await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u1", email: "a@test.local", name: "Agent", role: "AGENT", agencyId: "A" } });
  return db.booking.create({
    data: {
      reference: "APL-TEST0001",
      agencyId: "A",
      userId: "u1",
      status,
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
      leadPhone: "+972501234567",
      guests: [],
      refundable: true,
      totalMinor: 10_000,
      currency: "USD",
      price: {},
      cancelPenalties: [],
      nonrefundableDateRanges: [],
      priceCheckToken: "tok-a1",
    },
  });
}

describe("booking state machine", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("allows only the documented moves", () => {
    expect(canTransition("DRAFT", "PENDING_CONFIRMATION")).toBe(true);
    expect(canTransition("PENDING_CONFIRMATION", "CONFIRMED")).toBe(true);
    expect(canTransition("PENDING_CONFIRMATION", "FAILED")).toBe(true);
    expect(canTransition("CONFIRMED", "CANCEL_PENDING")).toBe(true);
    expect(canTransition("CANCEL_PENDING", "CANCELLED")).toBe(true);
    expect(canTransition("CANCEL_PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("FAILED", "PENDING_CONFIRMATION")).toBe(false);
  });

  it("moves the booking and writes one event row, in one transaction", async () => {
    const b = await booking();
    const moved = await db.$transaction((tx) => transition(tx, { bookingId: b.id, from: "DRAFT", to: "PENDING_CONFIRMATION", actorUserId: "u1", reason: "Agent booked", data: { holdId: "h1" } }));
    expect(moved).toMatchObject({ status: "PENDING_CONFIRMATION", holdId: "h1" });
    const events = await db.bookingEvent.findMany({ where: { bookingId: b.id } });
    expect(events).toEqual([expect.objectContaining({ fromStatus: "DRAFT", toStatus: "PENDING_CONFIRMATION", actorUserId: "u1", reason: "Agent booked" })]);
  });

  it("a booking that already moved is a conflict, and nothing is written (double click)", async () => {
    const b = await booking();
    await db.$transaction((tx) => transition(tx, { bookingId: b.id, from: "DRAFT", to: "PENDING_CONFIRMATION", actorUserId: "u1", reason: "first" }));
    await expect(db.$transaction((tx) => transition(tx, { bookingId: b.id, from: "DRAFT", to: "PENDING_CONFIRMATION", actorUserId: "u1", reason: "second" }))).rejects.toBeInstanceOf(BookingStateConflict);
    expect(await db.bookingEvent.count()).toBe(1);
  });

  it("refuses a move the table does not allow, even when the status matches", async () => {
    const b = await booking("CONFIRMED");
    await expect(db.$transaction((tx) => transition(tx, { bookingId: b.id, from: "CONFIRMED", to: "DRAFT", actorUserId: null, reason: "x" }))).rejects.toThrow(/not allowed/);
    expect((await db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CONFIRMED");
  });

  it("a system move (no user) is recorded with a null actor", async () => {
    const b = await booking();
    await db.$transaction((tx) => transition(tx, { bookingId: b.id, from: "DRAFT", to: "EXPIRED", actorUserId: null, reason: "Draft expired" }));
    expect((await db.bookingEvent.findFirstOrThrow()).actorUserId).toBeNull();
  });
});

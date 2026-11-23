import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { HANDLERS, onFinalFailure } from "./handlers";
import { JOB_KINDS } from "./kinds";

describe("HANDLERS", () => {
  it("has a handler for every job kind", () => {
    for (const kind of JOB_KINDS) expect(typeof HANDLERS[kind], kind).toBe("function");
  });

  it("the supplier check refuses a payload without a known scope", async () => {
    await expect(HANDLERS["booking.supplier-check"]!({})).rejects.toThrow();
    await expect(HANDLERS["booking.supplier-check"]!({ scope: "everything" })).rejects.toThrow();
  });
});

describe("onFinalFailure", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("a booking check that failed for the last time flags its waiting booking for an admin; other jobs flag nothing", async () => {
    await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
    await db.user.create({ data: { id: "u-A", email: "a@test.local", name: "A", role: "AGENT", agencyId: "A" } });
    await db.booking.create({
      data: {
        id: "bk1", reference: "APL-STUCK001", agencyId: "A", userId: "u-A", status: "PENDING_CONFIRMATION", propertyId: "1", hotelName: "H", hotelCity: "C", roomId: "r", roomName: "R", rateId: "x", bedGroupId: "b",
        bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567",
        guests: [], refundable: true, totalMinor: 10_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "t",
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await onFinalFailure({ id: "j1", kind: "email.booking", payload: { bookingId: "bk1", event: "confirmed" } });
    expect((await db.booking.findUniqueOrThrow({ where: { id: "bk1" } })).needsAttention).toBe(false);
    await onFinalFailure({ id: "j2", kind: "booking.reconcile", payload: { bookingId: "bk1" } });
    await onFinalFailure({ id: "j3", kind: "booking.reconcile", payload: { nonsense: true } });
    log.mockRestore();
    expect((await db.booking.findUniqueOrThrow({ where: { id: "bk1" } })).needsAttention).toBe(true);
    expect((await db.job.findMany({ where: { kind: "email.booking" } })).map((j) => j.payload)).toEqual([{ bookingId: "bk1", event: "needs_attention" }]);
  });
});

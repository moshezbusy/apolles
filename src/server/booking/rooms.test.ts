import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";

// Plan 10: the migration that gives bookings their rooms also gives every booking made before it
// exactly one room, from the booking's own fields. The test database is built with `db push`
// (no migration runs there), so this runs the migration's backfill statement itself.

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

function backfillSql(): string {
  const dir = readdirSync(MIGRATIONS).find((d) => d.endsWith("_plan10_booking_rooms"));
  if (!dir) throw new Error("plan10_booking_rooms migration not found");
  const sql = readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");
  const insert = /INSERT INTO "BookingRoom"[^;]*;/.exec(sql);
  if (!insert) throw new Error("backfill statement not found in the migration");
  return insert[0];
}

const guests = [
  { givenName: "Dana", familyName: "Levi", title: "MRS" },
  { givenName: "Noa", familyName: "Levi" },
];
const price = { total: { minor: 45_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 };

async function oldBooking(reference: string, data: Record<string, unknown> = {}) {
  return db.booking.create({
    data: {
      reference, agencyId: "A", userId: "u-A", status: "CONFIRMED",
      propertyId: "p1", hotelName: "Hotel", hotelCity: "Paris", roomId: "room1", roomName: "Double", rateId: "rate1", bedGroupId: "bed1", bedDescription: "1 King Bed",
      checkin: "2027-04-10", checkout: "2027-04-12", adults: 1, childAges: [6], leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567",
      guests, refundable: true, totalMinor: 45_000, currency: "USD", price, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok",
      ...data,
    },
  });
}

describe("booking rooms: the migration's backfill", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
    await db.user.create({ data: { id: "u-A", email: "a@test.local", name: "A", role: "AGENT", agencyId: "A" } });
  });

  it("gives every existing booking exactly one room, from the booking's own fields", async () => {
    const cancelledAt = new Date("2027-03-02T10:00:00Z");
    const confirmed = await oldBooking("APL-OLD00001", { supplierRoomId: "R-1", hotelConfirmationId: "HC-1", supplierLinks: { retrieve: "https://x/it/1", cancel: "https://x/it/1/rooms/R-1" } });
    const cancelled = await oldBooking("APL-OLD00002", { status: "CANCELLED", cancelledAt });
    const bySupplier = await oldBooking("APL-OLD00003", { status: "CANCELLED_BY_SUPPLIER", cancelledAt });
    const draft = await oldBooking("APL-OLD00004", { status: "DRAFT", supplierLinks: null });
    const pending = await oldBooking("APL-OLD00005", { status: "CANCEL_PENDING", supplierLinks: { retrieve: "https://x/it/5" } });

    await db.$executeRawUnsafe(backfillSql());

    const rooms = await db.bookingRoom.findMany();
    expect(rooms).toHaveLength(5);
    const of = (id: string) => rooms.find((r) => r.bookingId === id)!;
    expect(of(confirmed.id)).toMatchObject({
      index: 0, adults: 1, childAges: [6], guests, givenName: "Dana", familyName: "Levi", totalMinor: 45_000,
      supplierRoomId: "R-1", hotelConfirmationId: "HC-1", cancelLink: "https://x/it/1/rooms/R-1", status: "ACTIVE", cancelledAt: null,
    });
    expect(of(confirmed.id).price).toEqual(price);
    expect(of(cancelled.id)).toMatchObject({ status: "CANCELLED", cancelledAt });
    expect(of(bySupplier.id)).toMatchObject({ status: "CANCELLED", cancelledAt });
    expect(of(draft.id)).toMatchObject({ status: "ACTIVE", cancelLink: null, supplierRoomId: null });
    expect(of(pending.id)).toMatchObject({ status: "ACTIVE", cancelLink: null }); // cancelling, but not cancelled yet
  });

  it("running it again (or on a booking that has its room) adds nothing", async () => {
    const one = await oldBooking("APL-OLD00011");
    await db.$executeRawUnsafe(backfillSql());
    await db.$executeRawUnsafe(backfillSql());
    expect(await db.bookingRoom.count({ where: { bookingId: one.id } })).toBe(1);
  });
});

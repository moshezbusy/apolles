import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { credit } from "@/server/wallet/ledger";
import { sendEmail } from "@/server/email/port";
import { freeCancelEnds } from "./service";
import { lowBalanceCheck, sendTopupEmail } from "@/server/wallet/notifications";
import { sendBookingEmail, sendFreeCancelReminders } from "./emails";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  }),
}));

async function booking(status: "CONFIRMED" | "FAILED" | "CANCELLED" | "PENDING_CONFIRMATION") {
  await db.agency.create({ data: { id: "A", name: "Sunrise Travel", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u-A", email: "agent@sunrise.example", name: "Ruth", role: "AGENT", agencyId: "A" } });
  return db.booking.create({
    data: {
      id: "bk1", reference: "APL-MAIL0001", agencyId: "A", userId: "u-A", status, propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 48_375,
      chargedMinor: 48_375, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok-a1", hotelConfirmationId: "H-777",
      refundMinor: status === "CANCELLED" ? 48_375 : null, cancelChargeMinor: status === "CANCELLED" ? 0 : null,
    },
  });
}

// Plan 10: the booking as two rooms (the booking keeps every guest, room after room).
async function twoRooms() {
  await db.booking.update({
    where: { id: "bk1" },
    data: { adults: 3, childAges: [6], guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }, { givenName: "Yossi", familyName: "Cohen" }], hotelConfirmationId: null },
  });
  await db.bookingRoom.createMany({
    data: [
      { bookingId: "bk1", index: 0, adults: 2, childAges: [6], guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }], givenName: "Dana", familyName: "Levi", totalMinor: 30_000, price: {}, hotelConfirmationId: "H-777", cancelLink: "secret-cancel-1" },
      { bookingId: "bk1", index: 1, adults: 1, childAges: [], guests: [{ givenName: "Yossi", familyName: "Cohen" }], givenName: "Yossi", familyName: "Cohen", totalMinor: 18_375, price: {}, hotelConfirmationId: "H-778", cancelLink: "secret-cancel-2" },
    ],
  });
}

describe("booking emails (to the agent)", () => {
  beforeEach(async () => {
    await resetTestDb();
    sent.length = 0;
    vi.stubEnv("APP_URL", "https://staging.apolles.example");
    vi.stubEnv("ADMIN_ALERT_EMAIL", "alerts@apolles.example");
  });

  it("confirmed: reference, hotel, dates, guest, amount, hotel confirmation and a link; no tokens", async () => {
    await booking("CONFIRMED");
    await sendBookingEmail("bk1", "confirmed");
    // Only the confirmation: the low-balance email is its own job.
    expect(sent.map((x) => x.subject)).toEqual(["Booking confirmed: Hotel Lumiere, Apr 10, 2027 to Apr 12, 2027, APL-MAIL0001"]);
    const m = sent[0]!;
    expect(m.to).toBe("agent@sunrise.example");
    expect(m.subject).toBe("Booking confirmed: Hotel Lumiere, Apr 10, 2027 to Apr 12, 2027, APL-MAIL0001");
    expect(m.text).toContain("Your balance now: USD 0.00");
    for (const t of ["APL-MAIL0001", "Hotel Lumiere", "Apr 10, 2027 to Apr 12, 2027", "Dana Levi", "USD 483.75", "H-777", "https://staging.apolles.example/bookings/bk1"]) expect(m.text).toContain(t);
    expect(m.text).not.toContain("tok-a1");
  });

  it("not confirmed and cancelled say what happened to the money", async () => {
    await booking("FAILED");
    await sendBookingEmail("bk1", "failed");
    expect(sent[0]!.subject).toBe("Booking not confirmed: APL-MAIL0001");
    expect(sent[0]!.text).toContain("Nothing was charged");
    await db.booking.update({ where: { id: "bk1" }, data: { status: "CANCELLED", refundMinor: 48_375, cancelChargeMinor: 0 } });
    await sendBookingEmail("bk1", "cancelled");
    expect(sent[1]!.subject).toBe("Booking cancelled: APL-MAIL0001");
    expect(sent[1]!.text).toContain("Refunded to your balance: USD 483.75");
    expect(sent[1]!.text).toContain("Your balance now:");
  });

  it("needs attention goes to the admin, not the agent, true for every reason and without personal data", async () => {
    await booking("PENDING_CONFIRMATION");
    await sendBookingEmail("bk1", "needs_attention");
    expect(sent[0]!.to).toBe("alerts@apolles.example");
    expect(sent[0]!.subject).toBe("Apolles: booking APL-MAIL0001 needs attention");
    // Sent when the supplier check gave up, when the supplier's rooms do not match ours, or when
    // only some rooms were cancelled: the text claims none of these.
    expect(sent[0]!.text).toContain("Booking APL-MAIL0001 (status PENDING_CONFIRMATION) needs an admin to check it with the supplier");
    expect(sent[0]!.text).not.toContain("gave up");
    for (const t of ["Dana", "Levi", "dana@example.com", "501234567"]) expect(sent[0]!.text).not.toContain(t);
  });

  it("one room: the room's own hotel confirmation when the booking has none, and no room headings", async () => {
    await booking("CONFIRMED");
    await db.booking.update({ where: { id: "bk1" }, data: { hotelConfirmationId: null } });
    await db.bookingRoom.create({ data: { bookingId: "bk1", index: 0, adults: 2, childAges: [], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 48_375, price: {}, hotelConfirmationId: "H-ROOM1" } });
    await sendBookingEmail("bk1", "confirmed");
    expect(sent[0]!.text).toContain("Hotel confirmation: H-ROOM1");
    expect(sent[0]!.text).not.toContain("Room 1");
  });

  it("several rooms (plan 10): confirmed, cancelled and the reminder list every room with its guests and hotel confirmation", async () => {
    await booking("CONFIRMED");
    await twoRooms();
    await db.booking.update({ where: { id: "bk1" }, data: { freeCancelEndsAt: new Date("2099-04-07T12:00:00Z") } });
    await sendBookingEmail("bk1", "confirmed");
    await sendFreeCancelReminders(new Date("2099-04-05T12:00:00Z"));
    await db.booking.update({ where: { id: "bk1" }, data: { status: "CANCELLED", refundMinor: 48_375, cancelChargeMinor: 0 } });
    await sendBookingEmail("bk1", "cancelled");
    expect(sent.map((m) => m.subject)).toEqual([
      "Booking confirmed: Hotel Lumiere, Apr 10, 2027 to Apr 12, 2027, APL-MAIL0001",
      "Free cancellation ends in 72 hours: APL-MAIL0001",
      "Booking cancelled: APL-MAIL0001",
    ]);
    for (const m of sent) {
      for (const t of ["2 rooms", "Room 1 · 2 adults, 1 child (6)", "Room 2 · 1 adult", "Yossi Cohen"]) expect(m.text, `${m.subject}: ${t}`).toContain(t);
      expect(m.text).not.toContain("(child, age ?)");
      expect(m.text).not.toContain("secret-cancel");
    }
    for (const t of ["Noa Levi (child, age 6)", "Hotel confirmation: H-777", "Hotel confirmation: H-778"]) expect(sent[0]!.text, t).toContain(t);
    // Not confirmed: the rooms and their guests, no hotel confirmation.
    await db.booking.update({ where: { id: "bk1" }, data: { status: "FAILED" } });
    await sendBookingEmail("bk1", "failed");
    expect(sent[3]!.text).toContain("Room 2 · 1 adult");
    expect(sent[3]!.text).not.toContain("Hotel confirmation");
  });

  it("several rooms, cancelled: a room the hotel never confirmed is not promised a confirmation later", async () => {
    await booking("CANCELLED");
    await twoRooms();
    await db.bookingRoom.updateMany({ where: { bookingId: "bk1", index: 1 }, data: { hotelConfirmationId: null } });
    await sendBookingEmail("bk1", "cancelled");
    expect(sent[0]!.subject).toBe("Booking cancelled: APL-MAIL0001");
    expect(sent[0]!.text).toContain("Room 2 · 1 adult");
    expect(sent[0]!.text).not.toContain("sent by the hotel later");
    expect(sent[0]!.text).not.toContain("Hotel confirmation");
  });

  it("an email for a status the booking no longer has is skipped (never a wrong message)", async () => {
    await booking("PENDING_CONFIRMATION");
    await sendBookingEmail("bk1", "confirmed");
    expect(sent).toHaveLength(0);
  });

  it("confirmed: guests with titles, special requests and the free cancellation deadline", async () => {
    await booking("CONFIRMED");
    await db.booking.update({
      where: { id: "bk1" },
      data: { guests: [{ givenName: "Dana", familyName: "Levi", title: "MRS" }, { givenName: "Avi", familyName: "Levi" }], specialRequest: "High floor.", freeCancelEndsAt: new Date("2099-04-07T12:00:00Z") },
    });
    await sendBookingEmail("bk1", "confirmed");
    for (const t of ["Mrs Dana Levi", "Avi Levi", "High floor.", "Free cancellation until Apr 7, 2099, 12:00 UTC"]) expect(sent[0]!.text).toContain(t);
  });

  it("low balance: once per drop under USD 500; any credit back over 500 re-arms it; a failed send is retried", async () => {
    await booking("CONFIRMED");
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider down"));
    await expect(lowBalanceCheck("A")).rejects.toThrow("provider down");
    expect((await db.agency.findUniqueOrThrow({ where: { id: "A" } })).lowBalanceAlerted).toBe(false);
    await lowBalanceCheck("A");
    await lowBalanceCheck("A");
    expect(sent.filter((m) => m.subject === "Your Apolles balance is low")).toHaveLength(1);
    expect(sent.find((m) => m.subject === "Your Apolles balance is low")!.text).toContain("APL-A");
    // A refund (any credit) that brings the balance back to 500 or more clears the flag.
    await credit({ agencyId: "A", type: "REFUND", amountCents: 60_000, reason: "refund", idempotencyKey: "r1" });
    expect((await db.agency.findUniqueOrThrow({ where: { id: "A" } })).lowBalanceAlerted).toBe(false);
    const entry = await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 100_000, reason: "Bank transfer T1", idempotencyKey: "topup:T1" });
    await sendTopupEmail(entry.id);
    expect(sent.find((m) => m.subject === "USD 1,000.00 added to your Apolles balance")!.text).toContain("Your balance now: USD 1,600.00");
    await lowBalanceCheck("A"); // over 500: nothing
    expect(sent.filter((m) => m.subject === "Your Apolles balance is low")).toHaveLength(1);
  });

  it("the free cancellation deadline is promised only when cancelling really is free until then", () => {
    const start = "2099-04-07T14:00:00.000+02:00";
    expect(freeCancelEnds({ refundable: true, cancelPenalties: [{ start, end: start, amount: null, nights: 1, percent: null }] })).toEqual(new Date("2099-04-07T12:00:00Z"));
    expect(freeCancelEnds({ refundable: false, cancelPenalties: [{ start, end: start, amount: null, nights: 1, percent: null }] })).toBeNull();
    expect(freeCancelEnds({ refundable: true, cancelPenalties: [{ start: "soon", end: start, amount: null, nights: 1, percent: null }] })).toBeNull();
    expect(freeCancelEnds({ refundable: true, cancelPenalties: [{ start, end: start, amount: null, nights: 1, percent: null }], nonrefundableDateRanges: [{ start: "2099-04-10", end: "2099-04-11" }] })).toBeNull();
  });

  it("free cancellation ends in 72 hours: once per booking, only for confirmed ones in the window", async () => {
    await booking("CONFIRMED");
    const now = new Date("2099-04-05T12:00:00Z");
    await db.booking.update({ where: { id: "bk1" }, data: { freeCancelEndsAt: new Date("2099-04-07T12:00:00Z") } });
    expect(await sendFreeCancelReminders(new Date("2099-04-01T12:00:00Z"))).toBe(0); // too early
    expect(await sendFreeCancelReminders(now)).toBe(1);
    expect(await sendFreeCancelReminders(now)).toBe(0);
    const m = sent.find((x) => x.subject === "Free cancellation ends in 72 hours: APL-MAIL0001")!;
    expect(m.text).toContain("Apr 7, 2099, 12:00 UTC");
  });

  it("a reminder that could not be sent is tried again next hour; none for a booking made inside the 72 hours", async () => {
    await booking("CONFIRMED");
    const now = new Date("2099-04-05T12:00:00Z");
    await db.booking.update({ where: { id: "bk1" }, data: { freeCancelEndsAt: new Date("2099-04-07T12:00:00Z"), confirmedAt: new Date("2099-03-01T10:00:00Z") } });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider down"));
    await expect(sendFreeCancelReminders(now)).rejects.toThrow("provider down");
    expect((await db.booking.findUniqueOrThrow({ where: { id: "bk1" } })).freeCancelReminderAt).toBeNull();
    expect(await sendFreeCancelReminders(now)).toBe(1);
    // Booked late (inside the window): no reminder, and not tried again.
    await db.booking.update({ where: { id: "bk1" }, data: { freeCancelReminderAt: null, confirmedAt: new Date("2099-04-05T09:00:00Z") } });
    sent.length = 0;
    expect(await sendFreeCancelReminders(now)).toBe(0);
    expect(sent).toHaveLength(0);
    expect((await db.booking.findUniqueOrThrow({ where: { id: "bk1" } })).freeCancelReminderAt).not.toBeNull();
  });
});

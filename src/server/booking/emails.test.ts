import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { sendBookingEmail } from "./emails";

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
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("agent@sunrise.example");
    expect(m.subject).toBe("Booking confirmed: APL-MAIL0001, Hotel Lumiere");
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
  });

  it("needs attention goes to the admin, not the agent", async () => {
    await booking("PENDING_CONFIRMATION");
    await sendBookingEmail("bk1", "needs_attention");
    expect(sent[0]!.to).toBe("alerts@apolles.example");
    expect(sent[0]!.subject).toBe("Apolles: booking APL-MAIL0001 needs attention");
  });

  it("an email for a status the booking no longer has is skipped (never a wrong message)", async () => {
    await booking("PENDING_CONFIRMATION");
    await sendBookingEmail("bk1", "confirmed");
    expect(sent).toHaveLength(0);
  });
});

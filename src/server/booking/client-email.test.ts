import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { sendEmail, type EmailMessage } from "@/server/email/port";
import { seedRateLimit } from "@/test/rate-limit";
import { resetTestDb } from "@/test/db";
import { clientEmailDefault, emailBookingToClient } from "./client-email";

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn(async () => {}) }));

async function seed(status: "CONFIRMED" | "PENDING_CONFIRMATION" = "CONFIRMED") {
  await db.agency.create({ data: { id: "A", name: "Sunrise Travel", country: "IL", bankReference: "APL-A", email: "office@sunrise.example", phone: "+972 3 555 0000" } });
  await db.agency.create({ data: { id: "B", name: "Other", country: "IL", bankReference: "APL-B" } });
  await db.user.create({ data: { id: "u-A", email: "agent@sunrise.example", name: "Ruth", role: "AGENT", agencyId: "A" } });
  return db.booking.create({
    data: {
      id: "bk1", reference: "APL-MAIL0001", agencyId: "A", userId: "u-A", status, propertyId: "11", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", amenities: ["Breakfast buffet"], checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [6],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567",
      guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }],
      refundable: true, totalMinor: 48_375, chargedMinor: 48_375, sellMarkupType: "FIXED", sellMarkupValue: 6_625, currency: "USD",
      price: { total: { minor: 48_375, currency: "USD" }, lines: [], dueAtProperty: [{ kind: "resort_fee", amount: { minor: 4_000, currency: "USD" }, localAmount: { minor: 3_700, currency: "EUR" } }], dueAtPropertyTotal: { minor: 4_000, currency: "USD" }, nights: 2 },
      cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok-a1", hotelConfirmationId: "H-777", supplierItineraryId: "IT-999",
    },
  });
}

const sent = () => vi.mocked(sendEmail).mock.calls.map((c) => c[0] as EmailMessage);

describe("email the booking to the client (plan 8g)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(sendEmail).mockClear();
  });

  it("sends the voucher in the agency's name, with the stay and no price at all", async () => {
    await seed();
    expect(await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: " Client@Example.com " })).toEqual({ ok: true });
    const [msg] = sent();
    expect(msg).toMatchObject({ to: "client@example.com", fromName: "Sunrise Travel", replyTo: "office@sunrise.example", subject: "Your hotel booking: Hotel Lumiere, Apr 10 to Apr 12, 2027" });
    for (const t of ["Hotel Lumiere", "Superior King Room", "APL-MAIL0001", "H-777", "Dana Levi", "Noa Levi (child, age 6)", "Breakfast buffet", "USD 40.00"]) expect(msg!.text, t).toContain(t);
    // No price paid or sold for, no supplier, no Apolles brand.
    for (const t of ["483.75", "550.00", "66.25", "IT-999", "Expedia", "Apolles"]) expect(msg!.text, t).not.toContain(t);
    expect(msg!.attachments).toEqual([expect.objectContaining({ name: "hotel-voucher-APL-MAIL0001.pdf", contentType: "application/pdf" })]);
    expect(msg!.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "booking.email-client" } });
    expect(JSON.stringify(row)).not.toContain("client@example.com");
  });

  it("one room: as before plan 10, with the room's own hotel confirmation when the booking has none", async () => {
    await seed();
    await db.booking.update({ where: { id: "bk1" }, data: { hotelConfirmationId: null } });
    await db.bookingRoom.create({ data: { bookingId: "bk1", index: 0, adults: 2, childAges: [6], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 48_375, price: {}, hotelConfirmationId: "H-ROOM1" } });
    await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" });
    const text = sent()[0]!.text;
    expect(text).toContain("Hotel confirmation number: H-ROOM1");
    expect(text).toContain("Noa Levi (child, age 6)");
    expect(text).not.toContain("Room 1");
  });

  it("several rooms (plan 10): each room with its guests and hotel confirmation, in English and in Hebrew, still no price", async () => {
    await seed();
    await db.booking.update({
      where: { id: "bk1" },
      data: { adults: 3, guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }, { givenName: "Yossi", familyName: "Cohen" }], hotelConfirmationId: null },
    });
    await db.bookingRoom.createMany({
      data: [
        { bookingId: "bk1", index: 0, adults: 2, childAges: [6], guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }], givenName: "Dana", familyName: "Levi", totalMinor: 30_000, price: {}, hotelConfirmationId: "H-777", cancelLink: "secret-cancel-1" },
        { bookingId: "bk1", index: 1, adults: 1, childAges: [], guests: [{ givenName: "Yossi", familyName: "Cohen" }], givenName: "Yossi", familyName: "Cohen", totalMinor: 18_375, price: {}, hotelConfirmationId: "H-778" },
      ],
    });
    await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" });
    const en = sent()[0]!.text;
    for (const t of ["Rooms: 2 x Superior King Room", "Room 1 · 2 adults, 1 child (6)", "Room 2 · 1 adult", "Noa Levi (child, age 6)", "Yossi Cohen", "Hotel confirmation number: H-777", "Hotel confirmation number: H-778"]) expect(en, t).toContain(t);
    for (const t of ["(child, age ?)", "secret-cancel", "300.00", "183.75", "483.75"]) expect(en, t).not.toContain(t);

    const quote = await db.quote.create({ data: { agencyId: "A", createdById: "u-A", language: "HE" } });
    await db.booking.update({ where: { id: "bk1" }, data: { quoteId: quote.id } });
    await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" });
    const he = sent()[1]!.text;
    for (const t of ["חדר 1", "חדר 2", "Yossi Cohen", "מספר אישור במלון: H-777", "מספר אישור במלון: H-778"]) expect(he, t).toContain(t);
    expect(he).not.toContain("(child, age ?)");
  });

  it("in Hebrew when the booking came from a Hebrew quote; the box starts with the quote's client email", async () => {
    await seed();
    const client = await db.client.create({ data: { agencyId: "A", firstName: "Daniel", lastName: "K", email: "daniel@example.com", phone: "+972 50 555 0100", phoneDigits: "972505550100", nationality: "IL" } });
    const quote = await db.quote.create({ data: { agencyId: "A", createdById: "u-A", language: "HE", clientId: client.id } });
    await db.booking.update({ where: { id: "bk1" }, data: { quoteId: quote.id } });
    expect(await clientEmailDefault("A", "bk1")).toBe("daniel@example.com");
    expect(await clientEmailDefault("B", "bk1")).toBe("");
    await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "daniel@example.com" });
    expect(sent()[0]!.subject).toContain("ההזמנה שלכם");
  });

  it("refuses another agency's booking, an unconfirmed one, a bad address and unknown fields", async () => {
    await seed("PENDING_CONFIRMATION");
    expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" })).ok).toBe(false);
    await db.booking.update({ where: { id: "bk1" }, data: { status: "CONFIRMED" } });
    expect((await emailBookingToClient("u-B", "B", { bookingId: "bk1", email: "c@example.com" })).ok).toBe(false);
    expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "not an email" })).ok).toBe(false);
    expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com", cc: "x@y.z" } as never)).ok).toBe(false);
    expect(sent()).toHaveLength(0);
  });

  it("at most 5 a day per booking, 30 an hour and 100 a day per agency; the subject is one clean line", async () => {
    await seed();
    for (let i = 0; i < 5; i++) expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" })).ok).toBe(true);
    expect(await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" })).toEqual({ ok: false, error: expect.stringMatching(/later/) });
    await resetTestDb();
    await seed();
    await seedRateLimit("booking-email:agency:A", 30, 60 * 60_000);
    expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" })).ok).toBe(false);
    await resetTestDb();
    await seed();
    await seedRateLimit("booking-email:agency-day:A", 100, 24 * 60 * 60_000);
    expect((await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" })).ok).toBe(false);
    await resetTestDb();
    await seed();
    await db.booking.update({ where: { id: "bk1" }, data: { hotelName: "Hotel\r\nBcc: x@evil.example" } });
    vi.mocked(sendEmail).mockClear();
    await emailBookingToClient("u-A", "A", { bookingId: "bk1", email: "c@example.com" });
    expect(sent()[0]!.subject).toBe("Your hotel booking: Hotel Bcc: x@evil.example, Apr 10 to Apr 12, 2027");
  });
});

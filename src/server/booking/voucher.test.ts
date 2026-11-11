import { inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { VoucherNotAvailable, renderVoucher } from "./voucher";

// The text a PDF draws, from its (Flate-compressed) content streams. Enough to check what
// the voucher says without a PDF parser.
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>|\(((?:\\.|[^\\)])*)\)/g)) {
      out += t[1] ? Buffer.from(t[1], "hex").toString("latin1") : t[2]!;
    }
    out += "\n";
  }
  return out;
}

async function seed(status: "CONFIRMED" | "PENDING_CONFIRMATION" = "CONFIRMED") {
  await db.agency.create({ data: { id: "A", name: "Sunrise Travel", country: "IL", bankReference: "APL-A", email: "office@sunrise.example", phone: "+972 3 555 0000" } });
  await db.agency.create({ data: { id: "B", name: "Other", country: "IL", bankReference: "APL-B" } });
  await db.user.create({ data: { id: "u-A", email: "agent@sunrise.example", name: "Ruth", role: "AGENT", agencyId: "A" } });
  await db.propertyContentCache.create({
    data: {
      propertyId: "11",
      fetchedAt: new Date(),
      data: {
        propertyId: "11", name: "Hotel Lumiere", address: { line1: "1 Rue Example", city: "Paris", stateProvince: null, postalCode: "75001", countryCode: "FR" },
        starRating: "4.5", coordinates: null, heroImage: null, images: [], amenities: [],
        checkin: { beginTime: "3:00 PM", endTime: "midnight", instructions: "<p>Photo ID is required.</p>", specialInstructions: "Ring the bell.", minAge: 18 },
        checkout: { time: "11:00 AM" }, fees: { mandatory: "<p>City tax EUR 5 per night.</p>", optional: null }, knowBeforeYouGo: "<ul><li>No pets.</li></ul>",
        description: null, onsiteCurrency: "EUR", rooms: [],
      },
    },
  });
  return db.booking.create({
    data: {
      id: "bk1", reference: "APL-VOUCH001", agencyId: "A", userId: "u-A", status, propertyId: "11", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [6],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567",
      guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }],
      refundable: true, totalMinor: 48_375, chargedMinor: 48_375, currency: "USD",
      price: { total: { minor: 48_375, currency: "USD" }, lines: [], dueAtProperty: [{ kind: "resort_fee", amount: { minor: 4_000, currency: "USD" }, localAmount: { minor: 3_700, currency: "EUR" } }], dueAtPropertyTotal: { minor: 4_000, currency: "USD" }, nights: 2 },
      cancelPenalties: [{ start: "2027-04-07T00:00:00.000+02:00", end: "2027-04-10T23:59:00.000+02:00", amount: { minor: 9_000, currency: "USD" }, nights: null, percent: null }],
      nonrefundableDateRanges: [], priceCheckToken: "tok-a1", hotelConfirmationId: "H-777", supplierItineraryId: "IT-999",
    },
  });
}

describe("voucher PDF", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("is a PDF in the agency's name with everything the hotel and the guest need", async () => {
    await seed();
    const pdf = await renderVoucher("A", "bk1");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(pdf);
    for (const t of [
      "Sunrise Travel", "office@sunrise.example", "+972 3 555 0000", "APL-VOUCH001", "H-777", "Hotel Lumiere", "1 Rue Example", "Superior King Room", "1 King Bed",
      "Bed type is a request and not guaranteed", "Dana Levi", "Noa Levi (child, age 6)", "3:00 PM", "11:00 AM", "Photo ID is required.", "Ring the bell.",
      "City tax EUR 5 per night.", "No pets.", "EUR 37.00", "Cancellation",
    ]) expect(text, t).toContain(t);
  });

  it("never shows the price paid, the supplier's name or its itinerary number", async () => {
    await seed();
    const text = pdfText(await renderVoucher("A", "bk1"));
    expect(text).not.toContain("483.75");
    expect(text).not.toMatch(/expedia/i);
    expect(text).not.toContain("IT-999");
  });

  it("only for the agency's own confirmed booking", async () => {
    await seed("PENDING_CONFIRMATION");
    await expect(renderVoucher("A", "bk1")).rejects.toBeInstanceOf(VoucherNotAvailable);
    await expect(renderVoucher("B", "bk1")).rejects.toBeInstanceOf(VoucherNotAvailable);
  });
});

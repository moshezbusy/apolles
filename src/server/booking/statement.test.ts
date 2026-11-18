import { inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { StatementNotAvailable, renderStatement } from "./statement";

function pdfText(pdf: Buffer): string {
  let out = "";
  for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9a-fA-F]+)>|\(((?:\\.|[^\\)])*)\)/g)) out += t[1] ? Buffer.from(t[1], "hex").toString("latin1") : t[2]!;
  }
  return out;
}

async function seed(status: "CONFIRMED" | "CANCELLED" | "DRAFT") {
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-000${id === "A" ? 1 : 2}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await db.booking.create({
    data: {
      id: "bk1", reference: "APL-STMT0001", agencyId: "A", userId: "u-A", status, propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 48_375,
      chargedMinor: status === "DRAFT" ? null : 48_375, currency: "USD", price: { dueAtPropertyTotal: { minor: 3_700, currency: "EUR" } }, cancelPenalties: [], nonrefundableDateRanges: [],
      priceCheckToken: "tok", confirmedAt: new Date("2027-03-01T10:00:00Z"),
      ...(status === "CANCELLED" ? { cancelChargeMinor: 8_375, refundMinor: 40_000, cancelledAt: new Date("2027-03-05T10:00:00Z") } : {}),
    },
  });
}

describe("booking statement (22, not a tax invoice)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("shows what was paid from the balance, says it is not a tax invoice, for the agency's own booking only", async () => {
    await seed("CONFIRMED");
    const text = pdfText(await renderStatement("A", "bk1"));
    for (const t of ["Booking statement", "ST-STMT0001", "This is not a tax invoice.", "Agency A", "APL-0001", "APL-STMT0001", "Hotel Lumiere", "USD 483.75", "EUR 37.00"]) expect(text, t).toContain(t);
    await expect(renderStatement("B", "bk1")).rejects.toBeInstanceOf(StatementNotAvailable);
  });

  it("after a cancellation: the charge and the refund", async () => {
    await seed("CANCELLED");
    const text = pdfText(await renderStatement("A", "bk1"));
    for (const t of ["Cancellation statement", "CS-STMT0001", "Cancellation charge: USD 83.75", "Refunded to your balance: USD 400.00"]) expect(text, t).toContain(t);
  });

  it("nothing for a booking that was never paid", async () => {
    await seed("DRAFT");
    await expect(renderStatement("A", "bk1")).rejects.toBeInstanceOf(StatementNotAvailable);
  });
});

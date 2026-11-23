import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { DOCUMENT_LIMIT, PdfTimeout } from "@/server/booking/pdf-safety";
import * as statementModule from "@/server/booking/statement";
import * as voucherModule from "@/server/booking/voucher";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { GET as statement } from "./(agent)/bookings/[id]/statement/route";
import { GET as voucher } from "./(agent)/bookings/[id]/voucher/route";

// The voucher and statement download routes: safe headers, a per-agency limit, and a clear
// answer (never a hanging request) when a PDF cannot be finished.

vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function signInAs(agencyId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId: `u-${agencyId}`, agencyId });
}

const get = (route: typeof voucher, id = "bk1") => route(new Request(`http://localhost/bookings/${id}/x`), { params: Promise.resolve({ id }) });

async function seed() {
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await db.booking.create({
    data: {
      id: "bk1", reference: "APL-DOC00001", agencyId: "A", userId: "u-A", status: "CONFIRMED", propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 48_375,
      chargedMinor: 48_375, currency: "USD", price: { total: { minor: 48_375, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }, cancelPenalties: [], nonrefundableDateRanges: [],
      priceCheckToken: "tok", confirmedAt: new Date("2027-03-01T10:00:00Z"),
    },
  });
}

describe.each([
  ["voucher", voucher, () => vi.spyOn(voucherModule, "renderVoucher")],
  ["statement", statement, () => vi.spyOn(statementModule, "renderStatement")],
] as const)("GET /bookings/[id]/%s", (kind, route, spyOnRender) => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTestDb();
    await seed();
    signInAs("A");
  });

  it("serves the PDF as a download that is never cached and never type-guessed", async () => {
    const res = await get(route);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
  });

  it("404 for another agency's booking, with the same safe headers", async () => {
    signInAs("B");
    const res = await get(route);
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is limited per agency: over the limit nothing is rendered and the answer says when to retry", async () => {
    await seedRateLimit(`${kind}:agency:A`, DOCUMENT_LIMIT.limit, DOCUMENT_LIMIT.windowMs);
    const render = spyOnRender();
    const res = await get(route);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.text()).toBe("Too many downloads in a short time. Try again in a few minutes.");
    expect(render).not.toHaveBeenCalled();
    // Another agency has its own counter.
    signInAs("B");
    expect((await get(route)).status).toBe(404);
  });

  it("answers 503 with what to do when the PDF cannot be finished in time", async () => {
    spyOnRender().mockRejectedValue(new PdfTimeout());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(route);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("The document could not be made right now. Try again in a few minutes.");
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

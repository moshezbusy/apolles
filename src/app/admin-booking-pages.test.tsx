import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/server/auth/guards";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/server/auth/guards", () => ({ requireAdmin: vi.fn() }));

describe("admin booking and supplier log pages", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(requireAdmin).mockResolvedValue({ userId: "admin" });
    await db.agency.create({ data: { id: "A", name: "Agency A", country: "IL", bankReference: "APL-A" } });
    await db.user.create({ data: { id: "u-A", email: "a@t.local", name: "Agent A", role: "AGENT", agencyId: "A" } });
    await db.booking.create({
      data: {
        id: "bk1", reference: "APL-ADMIN001", agencyId: "A", userId: "u-A", status: "PENDING_CONFIRMATION", needsAttention: true, propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris",
        roomId: "r", roomName: "Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [],
        leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "d@e.co", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 10_000, currency: "USD",
        price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok-a1", supplierItineraryId: "IT-777",
      },
    });
    await db.supplierCallLog.create({ data: { id: "log1", supplier: "expedia", method: "POST", path: "/itineraries?token=[masked]", status: 500, durationMs: 1200, affiliateReferenceId: "APL-ADMIN001", requestBody: { email: "[masked]" } } });
  });

  it("lists bookings with the needs-attention flag and the supplier itinerary; the detail shows the history", async () => {
    const { default: ListPage } = await import("./admin/bookings/page");
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ attention: "1" }) }));
    expect(html).toContain("APL-ADMIN001");
    expect(html).toContain("Needs attention");
    expect(html).toContain("IT-777");
    const { default: DetailPage } = await import("./admin/bookings/[id]/page");
    const detail = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "bk1" }) }));
    expect(detail).toContain("the automatic check with the supplier gave up");
    expect(detail).toContain('href="/admin/supplier-log?ref=APL-ADMIN001"');
    await expect(DetailPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("supplier log list and one call with its masked bodies", async () => {
    const { default: LogPage } = await import("./admin/supplier-log/page");
    const html = renderToStaticMarkup(await LogPage({ searchParams: Promise.resolve({ ref: "APL-ADMIN001" }) }));
    expect(html).toContain("POST /itineraries?token=[masked]");
    const { default: CallPage } = await import("./admin/supplier-log/[id]/page");
    const call = renderToStaticMarkup(await CallPage({ params: Promise.resolve({ id: "log1" }) }));
    expect(call).toContain("[masked]");
  });

  it("every admin page checks the admin session", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    const { default: ListPage } = await import("./admin/bookings/page");
    await expect(ListPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
    const { default: LogPage } = await import("./admin/supplier-log/page");
    await expect(LogPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

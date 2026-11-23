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
    // True for every reason a booking is flagged (the check gave up, rooms that do not match, a part-refused cancellation).
    expect(detail).toContain("Needs attention: check this booking with the supplier, fix it with the tools on this page, then mark it resolved.");
    expect(detail).not.toContain("gave up");
    expect(detail).not.toContain(">Rooms<"); // one room: as before plan 10
    expect(detail).toContain('href="/admin/supplier-log?ref=APL-ADMIN001"');
    expect(detail).toContain('href="/admin/agencies/A/wallet"');
    await expect(DetailPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the admin tools shown depend on the booking's status", async () => {
    const { default: DetailPage } = await import("./admin/bookings/[id]/page");
    const tools = async () => {
      const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "bk1" }) }));
      return ["Mark resolved", "Check with the supplier now", "Cancel for the agent", "Review refund", "Release the hold"].filter((t) => html.includes(">" + t + "</button>"));
    };
    expect(await tools()).toEqual(["Mark resolved", "Check with the supplier now"]);
    await db.booking.update({ where: { id: "bk1" }, data: { holdId: "h1", needsAttention: false } });
    expect(await tools()).toEqual(["Check with the supplier now", "Release the hold"]);
    await db.booking.update({ where: { id: "bk1" }, data: { status: "CANCELLED_BY_SUPPLIER", chargedMinor: 10_000 } });
    expect(await tools()).toEqual(["Review refund"]);
    await db.booking.update({ where: { id: "bk1" }, data: { refundMinor: 10_000 } });
    expect(await tools()).toEqual([]);
  });

  it("the list filters by status, agency and booking date; the flagged bookings come first", async () => {
    const { default: ListPage } = await import("./admin/bookings/page");
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Needs attention (1)");
    for (const name of ["status", "agency", "from", "to", "q"]) expect(html).toContain(`name="${name}"`);
    const none = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ status: "CONFIRMED" }) }));
    expect(none).toContain("No bookings match these filters.");
  });

  it("several rooms (plan 10): a rooms table with each room's guests, supplier room id, hotel confirmation, status and price; never a cancel link or token", async () => {
    await db.booking.update({ where: { id: "bk1" }, data: { supplierLinks: { retrieve: "secret-retrieve", cancel: "secret-cancel-0" } } });
    await db.bookingRoom.createMany({
      data: [
        { bookingId: "bk1", index: 0, adults: 2, childAges: [6], guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }], givenName: "Dana", familyName: "Levi", totalMinor: 6_000, price: {}, supplierRoomId: "SUP-ROOM-1", hotelConfirmationId: "H-1", cancelLink: "secret-cancel-1" },
        { bookingId: "bk1", index: 1, adults: 1, childAges: [], guests: [{ givenName: "Yossi", familyName: "Cohen" }], givenName: "Yossi", familyName: "Cohen", totalMinor: 4_000, price: {}, supplierRoomId: "SUP-ROOM-2", hotelConfirmationId: null, cancelLink: "secret-cancel-2", status: "CANCELLED" },
      ],
    });
    const { default: DetailPage } = await import("./admin/bookings/[id]/page");
    const detail = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "bk1" }) }));
    for (const t of [">Rooms<", "Room 1 · 2 adults, 1 child (6)", "Room 2 · 1 adult", "Noa Levi (child, age 6)", "Yossi Cohen", "SUP-ROOM-1", "SUP-ROOM-2", "H-1", "USD 60.00", "USD 40.00", "Cancelled", "Active"]) expect(detail, t).toContain(t);
    for (const t of ["secret-cancel", "secret-retrieve", "tok-a1", "(child, age ?)"]) expect(detail, t).not.toContain(t);
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

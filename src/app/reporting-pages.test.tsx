import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
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
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function booking(agencyId: string, reference: string, data: Record<string, unknown> = {}) {
  return db.booking.create({
    data: {
      reference, agencyId, userId: `u-${agencyId}`, status: "CONFIRMED", propertyId: "1", hotelName: `Hotel ${agencyId}`, hotelCity: `City ${agencyId}`,
      roomId: "r", roomName: "Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567", guests: [], refundable: true,
      totalMinor: 100_000, chargedMinor: 100_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok", ...data,
    },
  });
}

beforeEach(async () => {
  await resetTestDb();
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await booking("A", "APL-AAAA0001", { sellMarkupType: "PERCENT", sellMarkupValue: 1000 });
  await booking("B", "APL-BBBB0001", { chargedMinor: 777_700, totalMinor: 777_700 });
  vi.mocked(requireAgent).mockResolvedValue({ userId: "u-A", agencyId: "A", sessionId: "session-1" });
});

describe("reporting (19)", () => {
  it("shows the session agency's numbers only, with the periods and the CSV link", async () => {
    const { default: Page } = await import("./(agent)/reporting/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Gross sales");
    expect(html).toContain("USD 1,100.00");
    expect(html).toContain("USD 100.00"); // profit
    expect(html).toContain("Hotel A");
    expect(html).not.toContain("Hotel B");
    expect(html).not.toContain("7,777.00");
    for (const label of ["This month", "Last 7 days", "Last month", "This year", "Custom range"]) expect(html).toContain(label);
    expect(html).toContain('href="/reporting/export?range=month"');
    const custom = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range: "custom", from: "2020-01-01", to: "2020-01-31" }) }));
    expect(custom).toContain("No bookings in this period.");
  });

  it("the CSV is the session agency's", async () => {
    const { GET } = await import("./(agent)/reporting/export/route");
    const res = await GET(new Request("http://x/reporting/export?range=month"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("APL-AAAA0001");
    expect(csv).not.toContain("APL-BBBB0001");
  });

  it("the bookings list shows the profit of a priced booking", async () => {
    const { default: List } = await import("./(agent)/bookings/page");
    const html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Paid · profit USD 100.00");
  });
});

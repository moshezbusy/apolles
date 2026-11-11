import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "TestBrowser/1.0", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function signInAs(agencyId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId: "user-1", agencyId });
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function seedDestination(): Promise<void> {
  await db.agency.create({ data: { id: "A", name: "Agency A", country: "IL", bankReference: "APL-A" } });
  await db.agency.create({ data: { id: "B", name: "Agency B", country: "GB", bankReference: "APL-B" } });
  await db.destination.create({
    data: { id: "paris", name: "Paris", nameFull: "Paris, Ile-de-France, France", type: "city", countryCode: "FR", propertyCount: 2, seenRunId: "r" },
  });
  for (const id of ["11", "12"]) {
    await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", rank: Number(id), expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: id } });
  }
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
  return data;
}

describe("search action and destinations (screen 07)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    await seedDestination();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a valid search goes to its results page", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", destinationLabel: "Paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: "2", childCount: "2", childAge: ["4", "9"] };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT:\/search\/[a-z0-9]+$/);
    const snapshot = await db.searchSnapshot.findFirstOrThrow();
    expect(snapshot.agencyId).toBe("A");
    expect(snapshot.query).toMatchObject({ destinationId: "paris", adults: 2, childAges: [4, 9], countryCode: "IL" });
    expect(await db.searchHotel.count({ where: { snapshotId: snapshot.id } })).toBe(2);
  });

  it("an agencyId in the form is never read: the search belongs to the session's agency", async () => {
    signInAs("B");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { agencyId: "A", destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: "2" };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await db.searchSnapshot.findFirstOrThrow()).agencyId).toBe("B");
  });

  it("bad input gives a message and keeps what was typed", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "paris", destinationLabel: "Paris", checkin: isoDaysFromNow(12), checkout: isoDaysFromNow(10), adults: "two" }));
    expect(state).toMatchObject({ status: "error", values: { destinationLabel: "Paris", adults: "two" } });
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("a child without an age is refused, never dropped from the search", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: "2", childCount: "2", childAge: ["4"] };
    const state = await startSearchAction(null, form(fields));
    expect(state?.message).toMatch(/age of each child/i);
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("no destination chosen from the list gives its own message", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "", destinationLabel: "Pari", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: "2" }));
    expect(state?.message).toMatch(/destination/i);
  });

  it("a supplier that is not set up shows 'search unavailable', not a crash", async () => {
    signInAs("A");
    vi.stubEnv("SUPPLIER_MODE", "");
    vi.stubEnv("EXPEDIA_API_KEY", "");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: "2" }));
    expect(state?.message).toMatch(/unavailable/i);
  });

  it("destination suggestions need an agent session and return JSON", async () => {
    signInAs("A");
    const { GET } = await import("./(agent)/search/destinations/route");
    const response = await GET(new Request("http://localhost/search/destinations?q=par"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(await response.json()).toEqual({ destinations: [{ id: "paris", label: "Paris, Ile-de-France, France", type: "city" }] });
  });

  it("the search page shows the form with sensible defaults and no nationality field", async () => {
    signInAs("A");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: SearchPage } = await import("./(agent)/search/page");
    const html = renderToStaticMarkup(await SearchPage());
    expect(html).toContain("Hotel search");
    expect(html).toContain('name="checkin"');
    expect(html).toContain('name="adults"');
    expect(html).not.toMatch(/nationality/i);
  });
});

describe("results page (screen 08)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    await seedDestination();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function search(agencyId: string): Promise<string> {
    const { startSearch } = await import("@/server/search/search");
    const input = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: 2, childAges: [5] };
    return (await startSearch({ agencyId, userId: "user-1", supplierContext: {} }, input)).snapshotId;
  }

  async function renderResults(id: string, params: Record<string, string | string[]> = {}): Promise<string> {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: ResultsPage } = await import("./(agent)/search/[id]/page");
    return renderToStaticMarkup(await ResultsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(params) }));
  }

  it("lists the priced hotels with the stay total, the count, filters and a link to each hotel", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id);
    expect(html).toContain("2 properties found");
    expect(html).toContain("Hotel 11");
    expect(html).toContain("Hotel 12");
    expect(html).toMatch(/USD [\d,]+\.\d{2}/);
    expect(html).toContain("2 nights, 2 adults, 1 child");
    expect(html).toContain(`href="/search/${id}/hotels/11"`);
    expect(html).toContain('name="room"');
    expect(html).toContain('name="free"');
    expect(html).not.toMatch(/per night/i); // no divided (rounded) price, BP5
  });

  it("the link to a hotel keeps the results page, so 'Back to hotels' returns to it", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id, { sort: "price_asc", cursor: "0" });
    expect(html).toContain(`href="/search/${id}/hotels/11?sort=price_asc&amp;cursor=0"`);
  });

  it("filters come from the URL", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id, { name: "Hotel 12" });
    expect(html).toContain("1 property found");
    expect(html).not.toContain(">Hotel 11<");
  });

  it("another agency's search id is not found (no IDOR)", async () => {
    signInAs("B");
    const id = await search("A");
    await expect(renderResults(id)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an expired search asks to search again", async () => {
    signInAs("A");
    const id = await search("A");
    await db.searchSnapshot.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const html = await renderResults(id);
    expect(html).toMatch(/expired/i);
    expect(html).toContain('href="/search"');
  });
});

describe("hotel page (screen 09)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    await seedDestination();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function searchAndRender(agencyId: string, viewer = agencyId): Promise<{ html: string; id: string }> {
    const { startSearch } = await import("@/server/search/search");
    const input = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), adults: 2, childAges: [] };
    const { snapshotId } = await startSearch({ agencyId, userId: "user-1", supplierContext: {} }, input);
    signInAs(viewer);
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
    const html = renderToStaticMarkup(
      await HotelPage({ params: Promise.resolve({ id: snapshotId, propertyId: "11" }), searchParams: Promise.resolve({ sort: "price_asc" }) }),
    );
    return { html, id: snapshotId };
  }

  it("shows every rate with what Expedia requires on this page", async () => {
    const { html, id } = await searchAndRender("A");
    expect(html).toContain("Hotel 11");
    expect(html).toContain("Standard Double Room");
    expect(html).toContain("Non-refundable"); // AP2
    expect(html).toContain("Free cancellation until"); // BP3
    expect(html).toContain("Bed type is a request and not guaranteed"); // AP1
    expect(html).toContain("1 King Bed");
    expect(html).toContain("2 Twin Beds");
    expect(html).toContain("Taxes and fees"); // BP5 / total with taxes
    expect(html).toContain("Paid at the property"); // BP4
    expect(html).toMatch(/EUR 37\.00/); // local currency, 2 nights × EUR 18.50
    expect(html).toContain(`href="/search/${id}?sort=price_asc"`); // back to the same results
  });

  it("shows the policies together (AP3), as plain text, never the supplier's HTML", async () => {
    const { html } = await searchAndRender("A");
    const policies = html.slice(html.indexOf('id="policies"'));
    for (const text of ["Check-in", "3:00 PM", "Check-out", "11:00 AM", "Special instructions", "Front desk staff", "Fees", "Resort fee", "Know before you go", "No pets allowed"]) {
      expect(policies).toContain(text);
    }
    expect(html).toContain("Government-issued photo identification is required at check-in.");
    expect(html).not.toMatch(/&lt;(p|ul|li)&gt;/);
  });

  it("never sends the price-check token to the browser", async () => {
    const { html } = await searchAndRender("A");
    expect(html).not.toContain("fake-11");
  });

  it("another agency's search gives not found (no IDOR)", async () => {
    await expect(searchAndRender("A", "B")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // "Add to quote" on the hotel page reads and updates the page URL.
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/search/x/hotels/p1",
  useSearchParams: () => new URLSearchParams(),
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
    const fields = { destinationId: "paris", destinationLabel: "Paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "2", room_children: "4,9" };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT:\/search\/[a-z0-9]+$/);
    const snapshot = await db.searchSnapshot.findFirstOrThrow();
    expect(snapshot.agencyId).toBe("A");
    expect(snapshot.query).toMatchObject({ destinationId: "paris", rooms: [{ adults: 2, childAges: [4, 9] }], countryCode: "IL" });
    expect(await db.searchHotel.count({ where: { snapshotId: snapshot.id } })).toBe(2);
  });

  it("recent searches: listed with Search again (which fills the form), Clear all; Needs attention shows a client's choice", async () => {
    await db.user.create({ data: { id: "user-1", email: "a@t.local", name: "A", role: "AGENT", agencyId: "A" } });
    signInAs("A");
    const { startSearchAction, clearRecentAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", destinationLabel: "Paris, France", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "3", room_children: "" };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT/);
    const recent = await db.recentSearch.findFirstOrThrow();
    await db.quote.create({ data: { agencyId: "A", createdById: "user-1", title: "Paris Spring", status: "SELECTED", selectedAt: new Date() } });
    const { default: SearchPage } = await import("./(agent)/search/page");
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Recent searches");
    expect(html).toContain(`href="/search?again=${recent.id}"`);
    // Dates as day/month/year, as in the search form (plan 9).
    const dmy = (iso: string) => iso.split("-").reverse().join("/");
    expect(html).toContain(`${dmy(fields.checkin)} to ${dmy(fields.checkout)}`);
    expect(html).toContain("Client selected an option");
    expect(html).toContain("Paris Spring");
    const again = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ again: recent.id }) }));
    expect(again).toContain('value="Paris, Ile-de-France, France"'); // the name read on the server, not the form's label
    // Another user's id is ignored; dates already past fall back to the defaults.
    const other = await db.recentSearch.create({ data: { agencyId: "B", userId: "user-1", destinationId: "paris", destinationName: "Not mine", checkin: "2020-01-01", checkout: "2020-01-03", adults: 1, childAges: [] } });
    expect(renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ again: other.id }) }))).not.toContain("Not mine");
    expect(again).not.toContain("Those dates have passed.");
    await db.recentSearch.update({ where: { id: recent.id }, data: { checkin: "2020-01-01", checkout: "2020-01-03" } });
    const past = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ again: recent.id }) }));
    expect(past).not.toContain('value="2020-01-01"');
    // The agent is told, instead of the dates being swapped quietly.
    expect(past).toContain("Those dates have passed. Pick new dates.");
    expect(html).not.toContain("Those dates have passed.");
    await expect(clearRecentAction()).rejects.toThrow("NEXT_REDIRECT:/search");
    expect(await db.recentSearch.count({ where: { agencyId: "A" } })).toBe(0);
    expect(await db.recentSearch.count({ where: { agencyId: "B" } })).toBe(1); // only the session agency's are cleared
  });

    it("an agencyId in the form is never read: the search belongs to the session's agency", async () => {
    signInAs("B");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { agencyId: "A", destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "2" };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await db.searchSnapshot.findFirstOrThrow()).agencyId).toBe("B");
  });

  it("bad input gives a message and keeps what was typed", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "paris", destinationLabel: "Paris", checkin: isoDaysFromNow(12), checkout: isoDaysFromNow(10), room_adults: "two" }));
    expect(state).toMatchObject({ status: "error", values: { destinationLabel: "Paris", rooms: [{ adults: "two", childAges: [] }] } });
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("a child without an age is refused, never dropped from the search", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "2", room_children: "4," };
    const state = await startSearchAction(null, form(fields));
    expect(state?.message).toMatch(/age of each child/i);
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("no destination chosen from the list gives its own message", async () => {
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "", destinationLabel: "Pari", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "2" }));
    expect(state?.message).toMatch(/destination/i);
  });

  it("a supplier that is not set up shows 'search unavailable', not a crash", async () => {
    signInAs("A");
    vi.stubEnv("SUPPLIER_MODE", "");
    vi.stubEnv("EXPEDIA_API_KEY", "");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const state = await startSearchAction(null, form({ destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: "2" }));
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

  it("destination suggestions are limited per user: one agent at the limit gets 429, a colleague still gets the list", async () => {
    const { GET } = await import("./(agent)/search/destinations/route");
    await seedRateLimit("destinations:user:user-1", 120, 60_000);
    signInAs("A");
    const refused = await GET(new Request("http://localhost/search/destinations?q=par"));
    expect(refused.status).toBe(429);
    vi.mocked(requireAgent).mockResolvedValue({ userId: "user-2", agencyId: "A" });
    const colleague = await GET(new Request("http://localhost/search/destinations?q=par"));
    expect(colleague.status).toBe(200);
    // The refused agent did not use up the agency's ceiling.
    const agencyHits = await db.rateLimitBucket.findMany({ where: { key: "destinations:agency:A" } });
    expect(agencyHits.reduce((n, b) => n + b.count, 0)).toBe(1);
  });

  it("the destination box says plainly that it finds cities and areas", async () => {
    signInAs("A");
    const { default: SearchPage } = await import("./(agent)/search/page");
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('placeholder="City or area, for example Paris"');
  });

  it("the search page shows the form with sensible defaults and no nationality field", async () => {
    signInAs("A");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: SearchPage } = await import("./(agent)/search/page");
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Hotel search");
    expect(html).toContain("Search hotel availability and rates."); // not "live": the demo shows sample data
    expect(html).toContain('name="checkin"');
    expect(html).toContain('name="room_adults"');
    expect(html).not.toMatch(/nationality/i);
    expect(html).toContain(">+ Add a room<"); // the fake supplier is on: several rooms are allowed
  });

  it("several rooms (plan 10): the search, its recent line and Search again keep every room", async () => {
    await db.user.create({ data: { id: "user-1", email: "a@t.local", name: "A", role: "AGENT", agencyId: "A" } });
    signInAs("A");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: ["2", "2"], room_children: ["7", ""] };
    await expect(startSearchAction(null, form(fields))).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await db.searchSnapshot.findFirstOrThrow()).query).toMatchObject({ rooms: [{ adults: 2, childAges: [7] }, { adults: 2, childAges: [] }] });
    const recent = await db.recentSearch.findFirstOrThrow();
    const { default: SearchPage } = await import("./(agent)/search/page");
    const html = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("2 rooms · 4 adults · 1 child");
    const again = renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({ again: recent.id }) }));
    expect([...again.matchAll(/name="room_adults" value="(\d+)"/g)].map((m) => m[1])).toEqual(["2", "2"]);
    expect([...again.matchAll(/name="room_children" value="([\d,]*)"/g)].map((m) => m[1])).toEqual(["7", ""]);
  });

  it("with the real supplier, more than one room is refused and the form offers no 'Add room'", async () => {
    signInAs("A");
    vi.stubEnv("SUPPLIER_MODE", "");
    const { startSearchAction } = await import("./(agent)/search/actions");
    const fields = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), room_adults: ["2", "1"], room_children: ["", ""] };
    const state = await startSearchAction(null, form(fields));
    expect(state).toMatchObject({ status: "error", message: "Several rooms are not available yet." });
    expect(await db.searchSnapshot.count()).toBe(0);
    const { default: SearchPage } = await import("./(agent)/search/page");
    expect(renderToStaticMarkup(await SearchPage({ searchParams: Promise.resolve({}) }))).not.toContain("+ Add a room");
  });
});

describe("results page (screen 08)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    await seedDestination();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function search(agencyId: string, rooms = [{ adults: 2, childAges: [5] }]): Promise<string> {
    const { startSearch } = await import("@/server/search/search");
    const input = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), rooms };
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

  it("several rooms: the stay names the rooms and the form keeps every room", async () => {
    signInAs("A");
    const id = await search("A", [{ adults: 2, childAges: [5] }, { adults: 2, childAges: [] }]);
    const html = await renderResults(id);
    expect(html).toContain("2 nights, 2 rooms, 4 adults, 1 child");
    expect([...html.matchAll(/name="room_adults" value="(\d+)"/g)].map((m) => m[1])).toEqual(["2", "2"]);
    expect(html).toContain("2 rooms · 5 guests");
    // Quotes are for one room (plan 10): the card says so instead of offering "Add to quote".
    expect(html).toContain("Quotes are for one room for now.");
    expect(html).not.toContain("Add to quote");
    expect(html).toContain("Book this room");
  });

  it("each card shows the room behind its price, with Book this room and Add to quote for that rate (no price-check token)", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id);
    const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId: id, propertyId: "11" } });
    const offers = hotel.offers as { rateId: string; roomName: string; price: { total: { minor: number } }; bedGroups: { priceCheckToken: string }[] }[];
    const best = [...offers].sort((x, y) => x.price.total.minor - y.price.total.minor)[0]!;
    expect(html).toContain("<strong>Room:</strong> ");
    expect(html).toContain(best.roomName.replace(/&/g, "&amp;"));
    // The rate is named by its room and its rate id together.
    const bestRoomId = (hotel.offers as { rateId: string; roomId: string }[]).find((o) => o.rateId === best.rateId)!.roomId;
    expect(html).toContain(`name="r" value="${bestRoomId}~${best.rateId}"`);
    expect(html).toContain("Book this room");
    expect(html).toContain("Add to quote");
    for (const o of offers) for (const b of o.bedGroups) expect(html).not.toContain(b.priceCheckToken);
  });

  it("the link to a hotel keeps the results page, so 'Back to hotels' returns to it", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id, { sort: "price_asc", cursor: "0" });
    expect(html).toContain(`href="/search/${id}/hotels/11?sort=price_asc&amp;cursor=0"`);
  });

  it("free cancellation badge: says 'on other rooms' when the room shown is non-refundable", async () => {
    signInAs("A");
    const id = await search("A");
    const html = await renderResults(id);
    expect(html).toContain("Non-refundable");
    expect(html).toContain("Free cancellation on other rooms");
    expect(html).not.toContain("Free cancellation available");
    const free = await renderResults(id, { free: "1" });
    expect(free).toContain("Free cancellation available");
    expect(free).not.toContain("on other rooms");
  });

  it("a price filter that cannot be read gives a message, not a silently emptied box", async () => {
    signInAs("A");
    const id = await search("A");
    expect(await renderResults(id, { min: "abc" })).toContain("Enter prices as numbers, for example 250.");
    expect(await renderResults(id, { min: "500", max: "100" })).toContain("The minimum price is above the maximum.");
    expect(await renderResults(id, { min: "100" })).not.toContain("Enter prices as numbers");
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
    // One click runs the same search again: a form with the search's id, not a link to an empty form.
    expect(html).toContain("Search again");
    expect(html).toContain(`name="snapshotId" value="${id}"`);
    expect(html).not.toContain('href="/search"');
  });

  it("Search again on expired results runs the same search (read from the stored one) and opens the new results, keeping the quote", async () => {
    await db.user.create({ data: { id: "user-1", email: "a@t.local", name: "A", role: "AGENT", agencyId: "A" } });
    signInAs("A");
    const id = await search("A", [{ adults: 2, childAges: [5] }]);
    await db.searchSnapshot.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const { searchAgainAction } = await import("./(agent)/search/actions");
    const quote = "q".repeat(25);
    // Fields other than the search id and the quote are never read.
    const failure = await searchAgainAction(form({ snapshotId: id, quote, destinationId: "elsewhere", checkin: "2020-01-01" })).catch((e: Error) => e);
    const target = String((failure as Error).message).match(/^NEXT_REDIRECT:\/search\/([a-z0-9]+)\?quote=q{25}$/);
    expect(target).not.toBeNull();
    expect(target![1]).not.toBe(id);
    const fresh = await db.searchSnapshot.findUniqueOrThrow({ where: { id: target![1]! } });
    expect(fresh).toMatchObject({ agencyId: "A", userId: "user-1" });
    expect(fresh.query).toMatchObject({ destinationId: "paris", rooms: [{ adults: 2, childAges: [5] }] });
    expect(fresh.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await db.recentSearch.count({ where: { userId: "user-1" } })).toBe(1);
  });

  it("Search again: another agency's search does nothing; a search that cannot run comes back with the reason", async () => {
    const id = await search("A");
    const { searchAgainAction } = await import("./(agent)/search/actions");
    signInAs("B");
    await expect(searchAgainAction(form({ snapshotId: id }))).rejects.toThrow("NEXT_REDIRECT:/search");
    expect(await db.searchSnapshot.count()).toBe(1);
    signInAs("A");
    // Its dates are over: the search is refused, and the expired page says what to do.
    await db.searchSnapshot.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000), query: { destinationId: "paris", checkin: "2020-01-01", checkout: "2020-01-03", rooms: [{ adults: 2, childAges: [] }], countryCode: "IL" } } });
    await expect(searchAgainAction(form({ snapshotId: id }))).rejects.toThrow(`NEXT_REDIRECT:/search/${id}?again=input`);
    expect(await renderResults(id, { again: "input" })).toContain("This search cannot be run again as it is. Check the destination, dates and guests above, then search.");
    // Searchable dates again, but the agent is over the limit.
    await db.searchSnapshot.update({ where: { id }, data: { query: { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), rooms: [{ adults: 2, childAges: [] }], countryCode: "IL" } } });
    await db.rateLimitBucket.deleteMany({ where: { key: "search:user:user-1" } });
    await seedRateLimit("search:user:user-1", 30, 60_000);
    await expect(searchAgainAction(form({ snapshotId: id }))).rejects.toThrow(`NEXT_REDIRECT:/search/${id}?again=limited`);
  });

  it("applying filters, changing the sort and clearing filters keep the quote the search adds to", async () => {
    signInAs("A");
    const id = await search("A");
    const quote = "q".repeat(25);
    const html = await renderResults(id, { quote, name: "Hotel" });
    expect(html).toContain(`<input type="hidden" name="quote" value="${quote}"/>`);
    expect(html).toContain(`href="/search/${id}?quote=${quote}"`); // Clear filters
    const plain = await renderResults(id, { name: "Hotel" });
    expect(plain).not.toContain('name="quote"');
    expect(plain).toContain(`href="/search/${id}"`);
  });

  it("paging says which hotels are shown, of how many", async () => {
    signInAs("A");
    const id = await search("A");
    expect(await renderResults(id)).toContain("1-2 of 2");
  });

  describe("a destination with more hotels than one supplier call", () => {
    // 252 hotels: the first search asks for 250, two remain for "Load more hotels".
    async function manyHotels(): Promise<void> {
      const ids = Array.from({ length: 250 }, (_, i) => String(100 + i));
      await db.property.createMany({ data: ids.map((id) => ({ id, name: `Inn ${id}`, city: "Paris", countryCode: "FR", rank: Number(id) - 99, expediaCollect: true, active: true, catalogSeenRunId: "r" })) });
      await db.destinationProperty.createMany({ data: ids.map((propertyId) => ({ destinationId: "paris", propertyId })) });
      // Hotels 11 and 12 come last in rank, so they are the two not asked for yet.
      await db.property.updateMany({ where: { id: { in: ["11", "12"] } }, data: { rank: 1_000 } });
    }

    it("says that only the first hotels are shown, and offers Load more with the page's query kept", async () => {
      signInAs("A");
      await manyHotels();
      const id = await search("A");
      const html = await renderResults(id, { sort: "price_asc", free: "1" });
      expect(html).toContain("Showing the first 250 of 252 hotels in this destination.");
      expect(html).toContain("Load more hotels");
      expect(html).toContain('<input type="hidden" name="back" value="sort=price_asc&amp;free=1"/>');
    });

    it("a hotel-name filter with no match says the rest is not loaded yet and offers Load more right there", async () => {
      signInAs("A");
      await manyHotels();
      const id = await search("A");
      const html = await renderResults(id, { name: "Hotel 11" });
      expect(html).toContain("No hotel matches these filters among the first 250 of 252 hotels in this destination. Load more hotels to look in the rest.");
      expect(html).not.toContain("No hotels match these filters.");
      expect(html.match(/Load more hotels</g)).toHaveLength(1); // the button, next to the message
      expect(html).toContain('name="back" value="name=Hotel+11"');
    });

    it("Load more returns to the same view (filters, sort, page, quote) and sends the agent's IP and browser to the supplier", async () => {
      signInAs("A");
      await manyHotels();
      const id = await search("A");
      const { FakeSupplierAdapter } = await import("@/server/supplier/fake");
      const spy = vi.spyOn(FakeSupplierAdapter.prototype, "searchAvailability");
      const { loadMoreAction } = await import("./(agent)/search/[id]/actions");
      const quote = "q".repeat(25);
      const back = `sort=price_asc&name=Hotel&stars=4&stars=5&cursor=20&quote=${quote}&evil=1&notice=unavailable`;
      try {
        await expect(loadMoreAction(form({ snapshotId: id, back }))).rejects.toThrow(`NEXT_REDIRECT:/search/${id}?sort=price_asc&name=Hotel&stars=4&stars=5&cursor=20&quote=${quote}`);
        expect((spy.mock.calls[0] as unknown[])[1]).toEqual({ customerIp: "203.0.113.9", userAgent: "TestBrowser/1.0" });
      } finally {
        spy.mockRestore();
      }
      expect((await db.searchSnapshot.findUniqueOrThrow({ where: { id } })).nextIndex).toBe(252);
      expect(await renderResults(id, { name: "Hotel 11" })).toContain("1 property found");
    });

    it("Load more that is refused says why, on the same view", async () => {
      signInAs("A");
      await manyHotels();
      const id = await search("A");
      const { loadMoreAction } = await import("./(agent)/search/[id]/actions");
      await db.rateLimitBucket.deleteMany({ where: { key: "search:user:user-1" } });
    await seedRateLimit("search:user:user-1", 30, 60_000);
      await expect(loadMoreAction(form({ snapshotId: id, back: "sort=price_desc" }))).rejects.toThrow(`NEXT_REDIRECT:/search/${id}?sort=price_desc&notice=limited`);
      expect(await renderResults(id, { sort: "price_desc", notice: "limited" })).toContain("Too many searches. Wait a minute and load more hotels again.");
      // A code the page does not know (anything can be typed in a URL) shows no message.
      expect(await renderResults(id, { notice: "constructor" })).not.toContain('role="alert"');
      // Another agency's id does nothing.
      signInAs("B");
      await expect(loadMoreAction(form({ snapshotId: id, back: "" }))).rejects.toThrow(`NEXT_REDIRECT:/search/${id}`);
      expect((await db.searchSnapshot.findUniqueOrThrow({ where: { id } })).nextIndex).toBe(250);
    });
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
    const input = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), rooms: [{ adults: 2, childAges: [] }] };
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

  it("room filters: room name, free cancellation only, and price order", async () => {
    const { id } = await searchAndRender("A");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
    const render = async (q: Record<string, string>) =>
      renderToStaticMarkup(await HotelPage({ params: Promise.resolve({ id, propertyId: "11" }), searchParams: Promise.resolve({ sort: "price_asc", ...q }) }));
    const all = await render({});
    expect(all).toContain('name="rq"');
    const free = await render({ rf: "1" });
    expect(free).not.toContain(">Non-refundable<");
    expect(free).toContain("Clear filters");
    const none = await render({ rq: "no such room" });
    expect(none).toContain("No room matches these filters.");
    expect(none).toContain('name="sort" value="price_asc"'); // the results filters are kept for "Back to hotels"
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

  it("names each rate by its room and rate id together, and shows the free-cancellation deadline in one wording", async () => {
    const { html } = await searchAndRender("A");
    expect(html).toContain('name="r" value="room-1~rate-0-1"');
    expect(html).toMatch(/Free cancellation until (Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}, \d{4}, 00:00 hotel time/);
    expect(html).not.toContain("Free cancellation before check-in");
  });

  it("expired prices: Search again in one click, and a way back to the hotels", async () => {
    const { id } = await searchAndRender("A");
    await db.searchSnapshot.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
    const html = renderToStaticMarkup(
      await HotelPage({ params: Promise.resolve({ id, propertyId: "11" }), searchParams: Promise.resolve({ sort: "price_asc", quote: "q".repeat(25) }) }),
    );
    expect(html).toContain("These prices expired");
    expect(html).toContain(`name="snapshotId" value="${id}"`);
    expect(html).toContain(`name="quote" value="${"q".repeat(25)}"`);
    expect(html).toContain(`href="/search/${id}?sort=price_asc&amp;quote=${"q".repeat(25)}"`);
    expect(html).toContain("Back to hotels");
    expect(html).not.toContain('href="/search"');
  });

  it("too many hotel pages: the message, and a way back to the hotels", async () => {
    const { id } = await searchAndRender("A");
    await db.rateLimitBucket.deleteMany({ where: { key: "hotel:user:user-1" } });
    await seedRateLimit("hotel:user:user-1", 120, 60_000);
    const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
    const html = renderToStaticMarkup(await HotelPage({ params: Promise.resolve({ id, propertyId: "11" }), searchParams: Promise.resolve({ sort: "price_asc" }) }));
    expect(html).toContain("Too many hotel pages opened. Wait a minute and try again.");
    expect(html).toContain(`href="/search/${id}?sort=price_asc"`);
    expect(html).toContain("Back to hotels");
  });

  it("never sends the price-check token to the browser", async () => {
    const { html } = await searchAndRender("A");
    expect(html).not.toContain("fake-11");
  });

  it("another agency's search gives not found (no IDOR)", async () => {
    await expect(searchAndRender("A", "B")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("one room: Add to quote on every rate; several rooms (plan 10): Quotes are for one room for now", async () => {
    const { html } = await searchAndRender("A");
    expect(html).toContain("Add to quote");
    expect(html).not.toContain("Quotes are for one room for now.");
    const { startSearch } = await import("@/server/search/search");
    const input = { destinationId: "paris", checkin: isoDaysFromNow(10), checkout: isoDaysFromNow(12), rooms: [{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }] };
    const { snapshotId } = await startSearch({ agencyId: "A", userId: "user-1", supplierContext: {} }, input);
    const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
    const several = renderToStaticMarkup(await HotelPage({ params: Promise.resolve({ id: snapshotId, propertyId: "11" }), searchParams: Promise.resolve({}) }));
    expect(several).toContain("Quotes are for one room for now.");
    expect(several).not.toContain("Add to quote");
    expect(several).toContain("Book room");
  });
});

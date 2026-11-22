import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { SupplierRateLimited } from "@/server/supplier/expedia/client";
import type { AvailabilityQuery, Offer, PropertyOffers, SupplierAdapter } from "@/server/supplier/types";
import { suggestDestinations } from "./destinations";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "./errors";
import { cleanupSnapshots, findOffer, getHotelOffers, listResults, loadMore, searchOneHotel, searchSummary, snapshotOffers, startSearch } from "./search";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const input = { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] as number[] }] };
const twoRooms = [{ adults: 2, childAges: [9] }, { adults: 1, childAges: [] }];

function offer(propertyId: string, totalMinor: number, refundable = true): Offer {
  return {
    propertyId,
    roomId: "r1",
    roomName: "Double",
    rateId: "rt1",
    refundable,
    bedGroups: [{ id: "b1", description: "1 Queen Bed", priceCheckToken: "tok-a1" }],
    cancelPenalties: [],
    nonrefundableDateRanges: [],
    amenities: [],
    price: { total: { minor: totalMinor, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
    roomPrices: [{ total: { minor: totalMinor, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }],
  };
}

function fakeAdapter(respond: (q: AvailabilityQuery) => PropertyOffers[] | Promise<PropertyOffers[]>) {
  const searchAvailability = vi.fn(async (q: AvailabilityQuery) => respond(q));
  return { adapter: { searchAvailability, priceCheck: vi.fn() } as unknown as SupplierAdapter, searchAvailability };
}

const everyone = (q: AvailabilityQuery) => q.propertyIds.map((id) => ({ propertyId: id, offers: [offer(id, 10_000 + Number(id))] }));

async function agency(id: string, country: string) {
  await db.agency.create({ data: { id, name: id, country, bankReference: `APL-${id}` } });
}

async function hotels(count: number, opts: { destinationId?: string; expediaCollect?: boolean; active?: boolean } = {}) {
  const destinationId = opts.destinationId ?? "paris";
  await db.destination.upsert({
    where: { id: destinationId },
    create: { id: destinationId, name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: count, seenRunId: "r" },
    update: {},
  });
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    await db.property.create({
      data: {
        id,
        name: `Hotel ${id}`,
        city: "Paris",
        countryCode: "FR",
        starRating: i % 2 === 0 ? "4.5" : "3.0",
        rank: i,
        expediaCollect: opts.expediaCollect ?? true,
        active: opts.active ?? true,
        catalogSeenRunId: "r",
      },
    });
    await db.destinationProperty.create({ data: { destinationId, propertyId: id } });
  }
}

const ctx = (agencyId = "A") => ({ agencyId, userId: "u1", supplierContext: { customerIp: "203.0.113.1" } });

describe("search service", () => {
  beforeEach(async () => {
    await resetTestDb();
    await agency("A", "IL");
    await agency("B", "US");
  });

  it("a destination with no searchable hotels gives an empty search and never calls Expedia", async () => {
    await hotels(3, { expediaCollect: false });
    const { adapter, searchAvailability } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    expect(searchAvailability).not.toHaveBeenCalled();
    const page = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(page?.hotels).toEqual([]);
  });

  it("sends the agency's country (point of sale), never one from the request; extra fields are refused", async () => {
    await hotels(2);
    const { adapter, searchAvailability } = fakeAdapter(everyone);
    await startSearch(ctx(), input, { adapter, now: NOW });
    expect(searchAvailability.mock.calls[0]![0]).toMatchObject({ countryCode: "IL", propertyIds: ["1", "2"], occupancies: [{ adults: 2, childAges: [] }] });
    await expect(startSearch(ctx(), { ...input, countryCode: "US" }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchInputInvalid);
  });

  it.each([
    ["29 nights", { checkout: "2027-05-09" }],
    ["check-in in the past", { checkin: "2027-02-27", checkout: "2027-03-02" }],
    ["check-in more than 365 days ahead", { checkin: "2028-03-02", checkout: "2028-03-04" }],
    ["checkout before check-in", { checkout: "2027-04-09" }],
    ["no adults", { rooms: [{ adults: 0, childAges: [] }] }],
    ["9 adults in a room", { rooms: [{ adults: 9, childAges: [] }] }],
    ["a child of 18", { rooms: [{ adults: 2, childAges: [18] }] }],
    ["7 children", { rooms: [{ adults: 2, childAges: [1, 2, 3, 4, 5, 6, 7] }] }],
    ["no rooms", { rooms: [] }],
    ["9 rooms", { rooms: Array.from({ length: 9 }, () => ({ adults: 1, childAges: [] })) }],
    ["a room with 0 adults among others", { rooms: [{ adults: 2, childAges: [] }, { adults: 0, childAges: [3] }] }],
    ["an unknown field in a room", { rooms: [{ adults: 2, childAges: [], extra: 1 }] }],
    ["the old one-room fields", { rooms: undefined, adults: 2, childAges: [] }],
    ["a date that does not exist", { checkin: "2027-02-30" }],
  ])("refuses %s", async (_label, patch) => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    await expect(startSearch(ctx(), { ...input, ...patch }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchInputInvalid);
  });

  it("600 hotels: first call 250 in rank order, load more 250, then 100 and no more", async () => {
    await hotels(600);
    const { adapter, searchAvailability } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const first = searchAvailability.mock.calls[0]![0].propertyIds;
    expect(first).toHaveLength(250);
    expect(first.slice(0, 3)).toEqual(["1", "2", "3"]);
    expect(await loadMore(ctx(), snapshotId, { adapter, now: NOW })).toEqual({ added: 250, hasMore: true });
    expect(await loadMore(ctx(), snapshotId, { adapter, now: NOW })).toEqual({ added: 100, hasMore: false });
    expect(searchAvailability.mock.calls[2]![0].propertyIds).toHaveLength(100);
  });

  it("two load-more calls at the same moment fetch the next batch only once", async () => {
    await hotels(600);
    const { adapter, searchAvailability } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    await Promise.all([loadMore(ctx(), snapshotId, { adapter, now: NOW }), loadMore(ctx(), snapshotId, { adapter, now: NOW })]);
    expect(searchAvailability).toHaveBeenCalledTimes(2);
    const snap = await db.searchSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snap.nextIndex).toBe(500);
  });

  it("an agency keeps at most 50 searches; older ones are removed", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    for (let i = 0; i < 52; i++) {
      await db.searchSnapshot.create({
        data: { agencyId: "A", userId: "u1", query: {}, candidateIds: [], createdAt: new Date(NOW.getTime() - (60 - i) * 1000), expiresAt: NOW },
      });
    }
    await startSearch(ctx(), input, { adapter, now: NOW });
    expect(await db.searchSnapshot.count({ where: { agencyId: "A" } })).toBe(50);
  });

  it("an assistant search keeps its own cap and never deletes the agent's searches", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    for (let i = 0; i < 50; i++) {
      await db.searchSnapshot.create({
        data: { agencyId: "A", userId: "u1", query: {}, candidateIds: [], createdAt: new Date(NOW.getTime() - (100 - i) * 1000), expiresAt: NOW },
      });
    }
    for (let i = 0; i < 25; i++) {
      await db.rateLimitBucket.deleteMany({ where: { key: "ai-search:agency:A" } }); // the cap is under test, not the rate
      await startSearch(ctx(), input, { adapter, now: new Date(NOW.getTime() + i * 1000), source: "AI" });
    }
    expect(await db.searchSnapshot.count({ where: { agencyId: "A", source: "WEB" } })).toBe(50);
    expect(await db.searchSnapshot.count({ where: { agencyId: "A", source: "AI" } })).toBe(20);
  });

  it("assistant searches use their own rate bucket", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    // 10 assistant searches already made this minute (seedRateLimit covers the next window too).
    await seedRateLimit("ai-search:agency:A", 10, 60_000);
    await expect(startSearch(ctx(), input, { adapter, now: NOW, source: "AI" })).rejects.toBeInstanceOf(SearchRateLimited);
    // The agent's own 30 a minute are untouched; the 31st is the web limit.
    for (let i = 0; i < 30; i++) await startSearch(ctx(), input, { adapter, now: NOW });
    await expect(startSearch(ctx(), input, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchRateLimited);
    // And one below the assistant limit still works.
    await db.rateLimitBucket.deleteMany({ where: { key: "ai-search:agency:A" } });
    await seedRateLimit("ai-search:agency:A", 9, 60_000);
    await expect(startSearch(ctx(), input, { adapter, now: NOW, source: "AI" })).resolves.toMatchObject({ snapshotId: expect.any(String) });
  });

  it("stored offers are checked when read back; a damaged row gives nothing instead of a broken page", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    await db.searchHotel.updateMany({ where: { snapshotId }, data: { offers: [{ broken: true }] } });
    expect(await getHotelOffers("A", snapshotId, "1", NOW, { content: async () => new Map() })).toBeNull();
  });

  it("another agency's search id gives nothing (no IDOR)", async () => {
    await hotels(3);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx("A"), input, { adapter, now: NOW });
    expect(await listResults("B", snapshotId, { sort: "recommended" }, NOW)).toBeNull();
    expect(await getHotelOffers("B", snapshotId, "1", NOW)).toBeNull();
    expect(await loadMore(ctx("B"), snapshotId, { adapter, now: NOW })).toBeNull();
  });

  it("ignores a hotel Expedia returns that was not asked for, and stores a duplicate once", async () => {
    await hotels(2);
    const { adapter } = fakeAdapter(() => [
      { propertyId: "1", offers: [offer("1", 30_000)] },
      { propertyId: "1", offers: [offer("1", 31_000)] },
      { propertyId: "999", offers: [offer("999", 1_000)] },
    ]);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const page = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(page?.hotels.map((h) => h.propertyId)).toEqual(["1"]);
  });

  it("sorts and filters from the stored results without calling Expedia again", async () => {
    await hotels(4);
    const { adapter, searchAvailability } = fakeAdapter((q) =>
      q.propertyIds.map((id) => ({ propertyId: id, offers: [offer(id, 50_000 - Number(id) * 1_000, id !== "3")] })),
    );
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const asc = await listResults("A", snapshotId, { sort: "price_asc" }, NOW);
    expect(asc?.hotels.map((h) => h.propertyId)).toEqual(["4", "3", "2", "1"]);
    expect(asc?.hotels[0]?.minTotal).toEqual({ minor: 46_000, currency: "USD" });
    const fourStars = await listResults("A", snapshotId, { sort: "recommended", stars: [4] }, NOW);
    expect(fourStars?.hotels.map((h) => h.propertyId)).toEqual(["2", "4"]);
    const named = await listResults("A", snapshotId, { sort: "recommended", name: "hotel 3" }, NOW);
    expect(named?.hotels.map((h) => h.propertyId)).toEqual(["3"]);
    const priced = await listResults("A", snapshotId, { sort: "price_desc", minPriceMinor: 47_000, maxPriceMinor: 48_000 }, NOW);
    expect(priced?.hotels.map((h) => h.propertyId)).toEqual(["2", "3"]);
    expect(searchAvailability).toHaveBeenCalledTimes(1);
  });

  it("filters by room name and by free cancellation", async () => {
    await hotels(3);
    const { adapter } = fakeAdapter((q) =>
      q.propertyIds.map((id) => ({
        propertyId: id,
        offers: [{ ...offer(id, 20_000, id === "2"), roomName: id === "1" ? "Ocean View King" : "Garden Double" }],
      })),
    );
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const ocean = await listResults("A", snapshotId, { sort: "recommended", roomName: "ocean view" }, NOW);
    expect(ocean?.hotels.map((h) => h.propertyId)).toEqual(["1"]);
    const free = await listResults("A", snapshotId, { sort: "recommended", freeCancellation: true }, NOW);
    expect(free?.hotels.map((h) => h.propertyId)).toEqual(["2"]);
  });

  it("filters match one rate on every rate filter, and the card shows that rate's price", async () => {
    await hotels(1);
    const cheapLocked = { ...offer("1", 10_000, false), roomId: "a", rateId: "a", roomName: "Garden Double" };
    const dearFree = { ...offer("1", 50_000, true), roomId: "b", rateId: "b", roomName: "Ocean Suite" };
    const { adapter } = fakeAdapter(() => [{ propertyId: "1", offers: [cheapLocked, dearFree] }]);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });

    const all = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(all?.hotels[0]).toMatchObject({ minTotal: { minor: 10_000 }, refundableAvailable: true });
    // Free cancellation under USD 200: no single rate is both, so no hotel.
    const none = await listResults("A", snapshotId, { sort: "recommended", freeCancellation: true, maxPriceMinor: 20_000 }, NOW);
    expect(none?.hotels).toEqual([]);
    expect(none?.total).toBe(0);
    // Free cancellation only: the hotel shows the price of its free-cancellation rate.
    const free = await listResults("A", snapshotId, { sort: "recommended", freeCancellation: true }, NOW);
    expect(free?.hotels[0]?.minTotal.minor).toBe(50_000);
    // A room name: that room's price.
    const garden = await listResults("A", snapshotId, { sort: "recommended", roomName: "garden" }, NOW);
    expect(garden?.hotels[0]).toMatchObject({ minTotal: { minor: 10_000 }, refundableAvailable: false });
    // Sorting by price uses the matching price.
    const ocean = await listResults("A", snapshotId, { sort: "price_asc", roomName: "ocean" }, NOW);
    expect(ocean?.hotels[0]?.minTotal.minor).toBe(50_000);
  });

  it("the card carries the rate behind its price (for Book / Add to quote) and how many other rates the hotel has", async () => {
    await hotels(1);
    const cheapLocked = { ...offer("1", 10_000, false), roomId: "a", rateId: "a", roomName: "Garden Double" };
    const dearFree = {
      ...offer("1", 50_000, true),
      roomId: "b",
      rateId: "b",
      roomName: "Ocean Suite",
      bedGroups: [
        { id: "k", description: "1 King Bed", priceCheckToken: "t-k" },
        { id: "t", description: "2 Twin Beds", priceCheckToken: "t-t" },
      ],
    };
    const third = { ...offer("1", 70_000, true), roomId: "c", rateId: "c", roomName: "Ocean Villa" };
    const { adapter } = fakeAdapter(() => [{ propertyId: "1", offers: [dearFree, cheapLocked, third] }]);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });

    const all = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(all?.hotels[0]?.best).toEqual({ offer: expect.objectContaining({ rateId: "a", roomName: "Garden Double", refundable: false }), otherRates: 2 });
    // The price-check tokens stay on the server.
    expect(all?.hotels[0]?.best?.offer.bedGroups).toEqual([{ id: "b1", description: "1 Queen Bed" }]);
    const free = await listResults("A", snapshotId, { sort: "recommended", freeCancellation: true }, NOW);
    expect(free?.hotels[0]?.best).toEqual({
      offer: expect.objectContaining({ rateId: "b", bedGroups: [{ id: "k", description: "1 King Bed" }, { id: "t", description: "2 Twin Beds" }] }),
      otherRates: 2,
    });
  });

  it("marks a hotel whose shown rate has fees paid at the property", async () => {
    await hotels(2);
    const withFee = (id: string): Offer => {
      const o = offer(id, 20_000);
      return { ...o, price: { ...o.price, dueAtProperty: [{ kind: "resort_fee", amount: { minor: 1_000, currency: "USD" }, localAmount: null }] } };
    };
    const { adapter } = fakeAdapter((q) => q.propertyIds.map((id) => ({ propertyId: id, offers: [id === "1" ? withFee(id) : offer(id, 20_000)] })));
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const page = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(page?.hotels.map((h) => [h.propertyId, h.feesAtProperty])).toEqual([
      ["1", true],
      ["2", false],
    ]);
  });

  it("a filter value with LIKE wildcards is matched literally", async () => {
    await hotels(2);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    expect((await listResults("A", snapshotId, { sort: "recommended", name: "%" }, NOW))?.hotels).toEqual([]);
    expect((await listResults("A", snapshotId, { sort: "recommended", roomName: "_" }, NOW))?.hotels).toEqual([]);
  });

  it("counts the matching hotels and summarises the search for the page header", async () => {
    await hotels(3);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const page = await listResults("A", snapshotId, { sort: "recommended", take: 2 }, NOW);
    expect(page?.total).toBe(3);
    expect(await searchSummary("A", snapshotId, NOW)).toEqual({
      destinationId: "paris",
      destinationLabel: "Paris, France",
      checkin: "2027-04-10",
      checkout: "2027-04-12",
      nights: 2,
      rooms: [{ adults: 2, childAges: [] }],
      adults: 2,
      childAges: [],
      expired: false,
    });
    expect(await searchSummary("B", snapshotId, NOW)).toBeNull();
    expect((await searchSummary("A", snapshotId, new Date(NOW.getTime() + 31 * 60_000)))?.expired).toBe(true);
  });

  it("pages the results with a cursor", async () => {
    await hotels(5);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const first = await listResults("A", snapshotId, { sort: "recommended", take: 2 }, NOW);
    expect(first?.hotels.map((h) => h.propertyId)).toEqual(["1", "2"]);
    const second = await listResults("A", snapshotId, { sort: "recommended", take: 2, cursor: first!.nextCursor! }, NOW);
    expect(second?.hotels.map((h) => h.propertyId)).toEqual(["3", "4"]);
  });

  it("Expedia unavailable or rate limited → SearchUnavailable; the 31st search in a minute → SearchRateLimited", async () => {
    await hotels(1);
    const failing = fakeAdapter(() => {
      throw new SupplierRateLimited("429", 429);
    });
    await expect(startSearch(ctx(), input, { adapter: failing.adapter, now: NOW })).rejects.toBeInstanceOf(SearchUnavailable);
    const { adapter } = fakeAdapter(everyone);
    // 30 searches already made this minute, in this window and the next (seedRateLimit), so the
    // result does not depend on a minute boundary passing during the test (it once did on CI).
    await db.rateLimitBucket.deleteMany({ where: { key: "search:agency:A" } });
    await seedRateLimit("search:agency:A", 30, 60_000);
    await expect(startSearch(ctx(), input, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchRateLimited);
  });

  it("one hotel (booking from a quote): only that hotel is asked; bad input, an inactive hotel and the rate limit refuse", async () => {
    await hotels(3);
    const { adapter, searchAvailability } = fakeAdapter(everyone);
    const { snapshotId } = await searchOneHotel(ctx(), { ...input, propertyId: "2" }, { adapter, now: NOW });
    expect(searchAvailability).toHaveBeenCalledTimes(1);
    expect(searchAvailability.mock.calls[0]?.[0]).toMatchObject({ propertyIds: ["2"], checkin: "2027-04-10", countryCode: "IL" });
    expect((await snapshotOffers("A", snapshotId, "2", NOW)).map((o) => o.propertyId)).toEqual(["2"]);
    expect(await snapshotOffers("B", snapshotId, "2", NOW)).toEqual([]);
    await expect(searchOneHotel(ctx(), { ...input, propertyId: "../x" }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchInputInvalid);
    await expect(searchOneHotel(ctx(), { ...input, checkin: "2020-01-01", propertyId: "2" }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchInputInvalid);
    await db.property.update({ where: { id: "3" }, data: { active: false } });
    await expect(searchOneHotel(ctx(), { ...input, propertyId: "3" }, { adapter, now: NOW })).rejects.toThrow(/can no longer be booked/);
    await db.rateLimitBucket.deleteMany({ where: { key: "search:agency:A" } });
    await seedRateLimit("search:agency:A", 30, 60_000);
    await expect(searchOneHotel(ctx(), { ...input, propertyId: "2" }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchRateLimited);
  });

  it("the 30th search in a minute is still allowed", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    await seedRateLimit("search:agency:A", 29, 60_000);
    await expect(startSearch(ctx(), input, { adapter, now: NOW })).resolves.toMatchObject({ snapshotId: expect.any(String) });
  });

  it("a search older than 30 minutes is expired and shows nothing", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const later = new Date(NOW.getTime() + 31 * 60_000);
    expect(await listResults("A", snapshotId, { sort: "recommended" }, later)).toMatchObject({ expired: true, hotels: [] });
    expect(await getHotelOffers("A", snapshotId, "1", later)).toBeNull();
  });

  it("getHotelOffers returns the stored offers of one hotel", async () => {
    await hotels(2);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const result = await getHotelOffers("A", snapshotId, "2", NOW, { content: async () => new Map() });
    expect(result?.offers[0]).toMatchObject({ propertyId: "2", price: { total: { minor: 10_002 } } });
    expect(result?.hotel).toEqual({ name: "Hotel 2", city: "Paris", starRating: "4.5" });
  });

  it("the hotel page still opens when hotel content cannot be loaded", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const broken = async () => {
      throw new Error("EXPEDIA_API_KEY is not set");
    };
    const result = await getHotelOffers("A", snapshotId, "1", NOW, { content: broken });
    expect(result?.content).toBeNull();
    expect(result?.offers).toHaveLength(1);
  });

  it("opening hotel pages is rate limited per agency (120 a minute)", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const none = async () => new Map();
    for (let i = 0; i < 120; i++) await getHotelOffers("A", snapshotId, "1", NOW, { content: none });
    await expect(getHotelOffers("A", snapshotId, "1", NOW, { content: none })).rejects.toBeInstanceOf(SearchRateLimited);
  });

  it("findOffer returns one rate of the agency's own search, never another agency's or an expired one", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const ref = { snapshotId, propertyId: "1", rateId: "rt1", bedGroupId: "b1" };
    const found = await findOffer("A", ref, NOW);
    expect(found).toMatchObject({ offer: { rateId: "rt1" }, bedGroup: { id: "b1", priceCheckToken: "tok-a1" }, hotel: { name: "Hotel 1" }, query: { adults: 2 }, rooms: [{ adults: 2, childAges: [] }] });
    expect(await findOffer("B", ref, NOW)).toBeNull();
    expect(await findOffer("A", { ...ref, bedGroupId: "nope" }, NOW)).toBeNull();
    expect(await findOffer("A", ref, new Date(NOW.getTime() + 31 * 60_000))).toBeNull();
  });

  it("cleanup deletes searches that expired more than an hour ago", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    await startSearch(ctx(), input, { adapter, now: NOW });
    expect(await cleanupSnapshots(new Date(NOW.getTime() + 60 * 60_000))).toBe(0);
    expect(await cleanupSnapshots(new Date(NOW.getTime() + 2 * 60 * 60_000))).toBe(1);
    expect(await db.searchHotel.count()).toBe(0);
  });
});

// Plan 10: several rooms in one search. More than one room only while the fake supplier is on
// (the staging demo and tests): with Expedia it is refused before Expedia is asked.
describe("search service: several rooms", () => {
  beforeEach(async () => {
    await resetTestDb();
    await agency("A", "IL");
    vi.stubEnv("SUPPLIER_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  // An offer priced for the rooms asked: one price per room, the total their sum.
  const forRooms = (q: AvailabilityQuery) =>
    q.propertyIds.map((id) => {
      const base = offer(id, 0);
      const roomPrices = q.occupancies.map((_, i) => ({ ...base.price, total: { minor: 10_000 + i * 1_000, currency: "USD" } }));
      const total = roomPrices.reduce((sum, p) => sum + p.total.minor, 0);
      return { propertyId: id, offers: [{ ...base, price: { ...base.price, total: { minor: total, currency: "USD" } }, roomPrices }] };
    });

  it("asks the supplier for every room, in order, and keeps the rooms with the search", async () => {
    await hotels(1);
    const { adapter, searchAvailability } = fakeAdapter(forRooms);
    const { snapshotId } = await startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW });
    expect(searchAvailability.mock.calls[0]![0].occupancies).toEqual(twoRooms);
    expect((await db.searchSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })).query).toMatchObject({ rooms: twoRooms });
    expect(await searchSummary("A", snapshotId, NOW)).toMatchObject({ rooms: twoRooms, adults: 3, childAges: [9] });
    const found = await findOffer("A", { snapshotId, propertyId: "1", rateId: "rt1", bedGroupId: "b1" }, NOW);
    expect(found?.rooms).toEqual(twoRooms);
    expect(found?.offer.roomPrices.map((p) => p.total.minor)).toEqual([10_000, 11_000]);
    expect(found?.offer.price.total.minor).toBe(21_000);
  });

  it("load more asks for the same rooms", async () => {
    await hotels(300);
    const { adapter, searchAvailability } = fakeAdapter(forRooms);
    const { snapshotId } = await startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW });
    await loadMore(ctx(), snapshotId, { adapter, now: NOW });
    expect(searchAvailability.mock.calls[1]![0].occupancies).toEqual(twoRooms);
  });

  it("an offer from the supplier that is not priced for exactly the rooms asked is not kept", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter((q) => {
      const [good] = forRooms(q)[0]!.offers;
      const wrongSum = { ...good!, rateId: "sum", price: { ...good!.price, total: { minor: 1, currency: "USD" } } };
      const oneRoom = { ...good!, rateId: "one", roomPrices: [good!.roomPrices[0]!], price: good!.roomPrices[0]! };
      return [{ propertyId: "1", offers: [wrongSum, good!, oneRoom] }];
    });
    const { snapshotId } = await startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW });
    expect((await snapshotOffers("A", snapshotId, "1", NOW)).map((o) => o.rateId)).toEqual(["rt1"]);
    const page = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    expect(page?.hotels[0]).toMatchObject({ minTotal: { minor: 21_000 }, best: { offer: expect.objectContaining({ rateId: "rt1" }), otherRates: 0 } });
  });

  it("with the real supplier, more than one room is refused before the supplier is asked", async () => {
    await hotels(1);
    vi.stubEnv("SUPPLIER_MODE", "expedia");
    const { adapter, searchAvailability } = fakeAdapter(forRooms);
    await expect(startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW })).rejects.toThrow(new SearchInputInvalid("Several rooms are not available yet."));
    expect(searchAvailability).not.toHaveBeenCalled();
    expect(await db.searchSnapshot.count()).toBe(0);
    // One room is still fine.
    await expect(startSearch(ctx(), input, { adapter, now: NOW })).resolves.toMatchObject({ snapshotId: expect.any(String) });
  });

  it("one hotel (booking from a quote) with the real supplier: more than one room is refused before the supplier is asked", async () => {
    await hotels(1);
    vi.stubEnv("SUPPLIER_MODE", "expedia");
    const { adapter, searchAvailability } = fakeAdapter(forRooms);
    await expect(searchOneHotel(ctx(), { ...input, rooms: twoRooms, propertyId: "1" }, { adapter, now: NOW })).rejects.toThrow(new SearchInputInvalid("Several rooms are not available yet."));
    expect(searchAvailability).not.toHaveBeenCalled();
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("load more of a several-room search with the real supplier is refused before the rate limit and the supplier", async () => {
    await hotels(300);
    const { adapter, searchAvailability } = fakeAdapter(forRooms);
    const { snapshotId } = await startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW });
    vi.stubEnv("SUPPLIER_MODE", "expedia");
    await db.rateLimitBucket.deleteMany({ where: { key: "search:agency:A" } });
    await seedRateLimit("search:agency:A", 30, 60_000); // a rate-limit answer would hide the room check
    await expect(loadMore(ctx(), snapshotId, { adapter, now: NOW })).rejects.toThrow(new SearchInputInvalid("Several rooms are not available yet."));
    expect(searchAvailability).toHaveBeenCalledTimes(1); // the first search only
  });

  it("a search stored before rooms (adults and childAges at the top) reads as one room", async () => {
    await hotels(1);
    const snapshot = await db.searchSnapshot.create({
      data: {
        agencyId: "A",
        userId: "u1",
        query: { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [], countryCode: "IL" },
        candidateIds: ["1"],
        nextIndex: 1,
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      },
    });
    const oldOffer: Partial<Offer> = offer("1", 20_000);
    delete oldOffer.roomPrices; // stored before plan 10
    await db.searchHotel.create({
      data: { snapshotId: snapshot.id, propertyId: "1", position: 0, name: "Hotel 1", city: "Paris", minTotalMinor: 20_000, currency: "USD", refundableAvailable: true, offers: [oldOffer] },
    });
    expect(await searchSummary("A", snapshot.id, NOW)).toMatchObject({ rooms: [{ adults: 2, childAges: [] }], adults: 2, childAges: [] });
    const found = await findOffer("A", { snapshotId: snapshot.id, propertyId: "1", rateId: "rt1", bedGroupId: "b1" }, NOW);
    expect(found?.rooms).toEqual([{ adults: 2, childAges: [] }]);
    expect(found?.offer.roomPrices).toEqual([found?.offer.price]);
  });

  it("a stored offer whose room prices do not add up to its total, or that has a price for another number of rooms, gives nothing", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(forRooms);
    const { snapshotId } = await startSearch(ctx(), { ...input, rooms: twoRooms }, { adapter, now: NOW });
    const ref = { snapshotId, propertyId: "1", rateId: "rt1", bedGroupId: "b1" };
    const none = async () => new Map();
    const stored = (await db.searchHotel.findFirstOrThrow({ where: { snapshotId } })).offers as unknown as Offer[];
    const good = stored[0]!;
    const save = (o: Offer) => db.searchHotel.updateMany({ where: { snapshotId }, data: { offers: [o] as never } });

    await save({ ...good, price: { ...good.price, total: { minor: 21_001, currency: "USD" } } }); // 10,000 + 11,000 ≠ 21,001
    expect(await findOffer("A", ref, NOW)).toBeNull();
    expect(await getHotelOffers("A", snapshotId, "1", NOW, { content: none })).toBeNull();
    expect(await snapshotOffers("A", snapshotId, "1", NOW)).toEqual([]);
    expect((await listResults("A", snapshotId, { sort: "recommended" }, NOW))?.hotels[0]?.best).toBeNull();

    await save({ ...good, roomPrices: [good.roomPrices[0]!, { ...good.roomPrices[1]!, total: { minor: 11_000, currency: "EUR" } }] }); // another currency
    expect(await findOffer("A", ref, NOW)).toBeNull();

    await save({ ...good, price: { ...good.price, total: { minor: 10_000, currency: "USD" } }, roomPrices: [good.roomPrices[0]!] }); // one room's price, two rooms searched
    expect(await findOffer("A", ref, NOW)).toBeNull();
    expect(await getHotelOffers("A", snapshotId, "1", NOW, { content: none })).toBeNull();

    await save(good);
    expect(await findOffer("A", ref, NOW)).not.toBeNull();
  });
});

describe("suggestDestinations", () => {
  beforeEach(async () => {
    await resetTestDb();
    const d = (id: string, name: string, propertyCount: number, active = true) =>
      db.destination.create({ data: { id, name, nameFull: `${name}, X`, type: "city", countryCode: "FR", propertyCount, active, seenRunId: "r" } });
    await d("1", "Paris", 900);
    await d("2", "Palma", 300);
    await d("3", "Pamplona", 100, false);
    await d("4", "Rome", 800);
  });

  it("matches the start of the name, active only, bigger first", async () => {
    expect((await suggestDestinations("pa")).map((s) => s.label)).toEqual(["Paris, X", "Palma, X"]);
  });

  it("too short, too long, or a wildcard character returns nothing unexpected", async () => {
    expect(await suggestDestinations("p")).toEqual([]);
    expect(await suggestDestinations("x".repeat(61))).toEqual([]);
    expect(await suggestDestinations("%a")).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { SupplierRateLimited } from "@/server/supplier/expedia/client";
import type { AvailabilityQuery, Offer, PropertyOffers, SupplierAdapter } from "@/server/supplier/types";
import { suggestDestinations } from "./destinations";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "./errors";
import { cleanupSnapshots, findOffer, getHotelOffers, listResults, loadMore, searchSummary, startSearch } from "./search";

const NOW = new Date("2027-03-01T10:00:00.000Z");

// Rate limits count per calendar minute (database clock). A test that counts hits starts well
// inside a minute, so its hits never straddle two windows (which would reset the count).
async function startInsideMinute(): Promise<void> {
  const second = new Date().getUTCSeconds();
  if (second >= 40) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000));
}
const input = { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [] as number[] };

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
    price: { total: { minor: totalMinor, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
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
    expect(searchAvailability.mock.calls[0]![0]).toMatchObject({ countryCode: "IL", propertyIds: ["1", "2"], occupancy: { adults: 2, childAges: [] } });
    await expect(startSearch(ctx(), { ...input, countryCode: "US" }, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchInputInvalid);
  });

  it.each([
    ["29 nights", { checkout: "2027-05-09" }],
    ["check-in in the past", { checkin: "2027-02-27", checkout: "2027-03-02" }],
    ["check-in more than 365 days ahead", { checkin: "2028-03-02", checkout: "2028-03-04" }],
    ["checkout before check-in", { checkout: "2027-04-09" }],
    ["no adults", { adults: 0 }],
    ["a child of 18", { childAges: [18] }],
    ["7 children", { childAges: [1, 2, 3, 4, 5, 6, 7] }],
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
    await startInsideMinute();
    await hotels(1);
    const failing = fakeAdapter(() => {
      throw new SupplierRateLimited("429", 429);
    });
    await expect(startSearch(ctx(), input, { adapter: failing.adapter, now: NOW })).rejects.toBeInstanceOf(SearchUnavailable);
    const { adapter } = fakeAdapter(everyone);
    for (let i = 0; i < 29; i++) await startSearch(ctx(), input, { adapter, now: NOW });
    await expect(startSearch(ctx(), input, { adapter, now: NOW })).rejects.toBeInstanceOf(SearchRateLimited);
  }, 30_000);

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
    await startInsideMinute();
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const none = async () => new Map();
    for (let i = 0; i < 120; i++) await getHotelOffers("A", snapshotId, "1", NOW, { content: none });
    await expect(getHotelOffers("A", snapshotId, "1", NOW, { content: none })).rejects.toBeInstanceOf(SearchRateLimited);
  }, 30_000);

  it("findOffer returns one rate of the agency's own search, never another agency's or an expired one", async () => {
    await hotels(1);
    const { adapter } = fakeAdapter(everyone);
    const { snapshotId } = await startSearch(ctx(), input, { adapter, now: NOW });
    const ref = { snapshotId, propertyId: "1", rateId: "rt1", bedGroupId: "b1" };
    const found = await findOffer("A", ref, NOW);
    expect(found).toMatchObject({ offer: { rateId: "rt1" }, bedGroup: { id: "b1", priceCheckToken: "tok-a1" }, hotel: { name: "Hotel 1" }, query: { adults: 2 } });
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

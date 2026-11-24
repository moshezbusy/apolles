import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import type { AvailabilityQuery, Offer, PropertyOffers, SupplierAdapter } from "@/server/supplier/types";
import { assistantHotelRates, assistantSearchHotels } from "./search";

// What an assistant gets back (plan 2026-11-22-mcp-search-connector, design 4): hotels and rates,
// with a link to open each in Apolles. Never a guest, a client, a booking, the balance, the
// supplier's name, a price-check token or a rate id.

const NOW = new Date("2027-03-01T10:00:00.000Z");
const FREE_UNTIL = [{ start: "2027-04-07T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }];

function offer(propertyId: string, totalMinor: number, opts: { supplier?: "hotelbeds"; refundable?: boolean } = {}): Offer {
  const refundable = opts.refundable ?? true;
  const price = {
    total: { minor: totalMinor, currency: "USD" },
    lines: [
      { kind: "room_rate" as const, amount: { minor: totalMinor - 2_000, currency: "USD" } },
      { kind: "taxes_and_fees" as const, amount: { minor: 2_000, currency: "USD" } },
    ],
    dueAtProperty: [{ kind: "resort_fee" as const, amount: { minor: 3_000, currency: "USD" }, localAmount: { minor: 2_800, currency: "EUR" } }],
    dueAtPropertyTotal: { minor: 3_000, currency: "USD" },
    nights: 2,
  };
  return {
    propertyId,
    roomId: "r1",
    roomName: "Deluxe Double",
    rateId: "secret-rate-id",
    refundable,
    bedGroups: [{ id: "b1", description: "1 King Bed", priceCheckToken: "SECRET-PRICE-CHECK-TOKEN" }],
    cancelPenalties: refundable ? FREE_UNTIL : [],
    nonrefundableDateRanges: [],
    amenities: ["Breakfast included"],
    price,
    roomPrices: [price],
    ...(opts.supplier ? { supplier: opts.supplier } : {}),
  };
}

function adapter(respond: (q: AvailabilityQuery) => PropertyOffers[]) {
  return { searchAvailability: vi.fn(async (q: AvailabilityQuery) => respond(q)), priceCheck: vi.fn() } as unknown as SupplierAdapter;
}

const everyone = adapter((q) => q.propertyIds.map((id) => ({ propertyId: id, offers: [offer(id, 40_000 + Number(id) * 100, Number(id) === 2 ? { supplier: "hotelbeds" } : {})] })));

async function seedParis(count = 3) {
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 900, seenRunId: "r" } });
  await db.destination.create({ data: { id: "parisvic", name: "Paris (and vicinity)", nameFull: "Paris (and vicinity), France", type: "multi_city_vicinity", countryCode: "FR", propertyCount: 100, seenRunId: "r" } });
  for (let i = 1; i <= count; i++) {
    await db.property.create({ data: { id: String(i), name: `Hotel ${i}`, city: "Paris", countryCode: "FR", starRating: i % 2 ? "4.0" : "5.0", rank: i, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: String(i) } });
  }
}

const A = { agencyId: "A", userId: "uA" };
const B = { agencyId: "B", userId: "uB" };
const stay = { checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] };
const deps = { adapter: everyone, now: NOW, content: async () => new Map(), appUrl: "https://app.apolles.test" };

describe("assistant search", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
    await db.agency.create({ data: { id: "B", name: "B", country: "US", bankReference: "APL-B" } });
    await seedParis();
  });

  it("finds the destination by name, lists hotels with prices and a link into Apolles", async () => {
    const result = await assistantSearchHotels(A, { destination: "Paris", ...stay }, deps);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.destination).toEqual({ id: "paris", name: "Paris, France" });
    expect(result.data.otherDestinations).toEqual([{ id: "parisvic", name: "Paris (and vicinity), France" }]);
    expect(result.data.nights).toBe(2);
    expect(result.data.hotelsFound).toBe(3);
    const first = result.data.hotels[0]!;
    expect(first).toEqual({
      hotelId: "1",
      name: "Hotel 1",
      stars: "4",
      area: "Paris",
      priceFrom: { total: "USD 401.00", averagePerNight: "USD 200.50" },
      freeCancellationAvailable: true,
      payAtHotelFees: true,
      openInApolles: `https://app.apolles.test/search/${result.data.searchId}/hotels/1`,
    });
  });

  it("filters and sorts like the results page", async () => {
    const result = await assistantSearchHotels(A, { destinationId: "paris", ...stay, sort: "price_desc", stars: [5], limit: 5 }, deps);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.hotels.map((h) => h.hotelId)).toEqual(["2"]);
  });

  it("says so when no destination matches, and refuses bad input and unknown fields", async () => {
    expect(await assistantSearchHotels(A, { destination: "Atlantis", ...stay }, deps)).toEqual({ ok: false, code: "not_found", message: expect.stringContaining("No destination") });
    for (const bad of [{ ...stay }, { destination: "Paris", ...stay, checkout: "2027-04-10" }, { destination: "Paris", ...stay, guestName: "John Smith" }, { destination: "Paris", ...stay, rooms: [] }]) {
      const result = await assistantSearchHotels(A, bad, deps);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("gives the rates of one hotel: room, what is included, prices, fees at the hotel and the cancellation rule", async () => {
    const found = await assistantSearchHotels(A, { destination: "Paris", ...stay }, deps);
    if (!found.ok) throw new Error(found.message);
    const rates = await assistantHotelRates(A, { searchId: found.data.searchId, hotelId: "1" }, deps);
    if (!rates.ok) throw new Error(rates.message);
    expect(rates.data.hotel).toEqual({ hotelId: "1", name: "Hotel 1", stars: "4", area: "Paris" });
    expect(rates.data.rates).toEqual([
      {
        room: "Deluxe Double",
        beds: ["1 King Bed"],
        includes: ["Breakfast included"],
        total: "USD 401.00",
        averagePerNight: "USD 200.50",
        priceLines: [
          { label: "Room", amount: "USD 381.00" },
          { label: "Taxes and fees", amount: "USD 20.00" },
        ],
        payAtHotel: [{ label: "Resort fee", amount: "USD 30.00", localAmount: "EUR 28.00" }],
        freeCancellation: true,
        cancellation: expect.stringContaining("Free cancellation until"),
      },
    ]);
    expect(rates.data.openInApolles).toBe(`https://app.apolles.test/search/${found.data.searchId}/hotels/1`);
  });

  it("never returns the supplier, rate ids, price-check tokens or anyone's personal data", async () => {
    const found = await assistantSearchHotels(A, { destination: "Paris", ...stay }, deps);
    if (!found.ok) throw new Error(found.message);
    const rates = await assistantHotelRates(A, { searchId: found.data.searchId, hotelId: "2" }, deps);
    const text = JSON.stringify([found, rates]).toLowerCase();
    for (const word of ["hotelbeds", "expedia", "supplier", "secret-rate-id", "secret-price-check-token", "pricechecktoken", "booking", "balance", "guest", "client", "email", "phone"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("another agency's search is not found (no IDOR)", async () => {
    const found = await assistantSearchHotels(A, { destination: "Paris", ...stay }, deps);
    if (!found.ok) throw new Error(found.message);
    expect(await assistantHotelRates(B, { searchId: found.data.searchId, hotelId: "1" }, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect(await assistantHotelRates(A, { searchId: found.data.searchId, hotelId: "999" }, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect(await assistantHotelRates(A, { searchId: found.data.searchId, hotelId: "1", extra: 1 }, deps)).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("an expired search says to search again", async () => {
    const found = await assistantSearchHotels(A, { destination: "Paris", ...stay }, deps);
    if (!found.ok) throw new Error(found.message);
    const later = { ...deps, now: new Date(NOW.getTime() + 31 * 60_000) };
    expect(await assistantHotelRates(A, { searchId: found.data.searchId, hotelId: "1" }, later)).toMatchObject({ ok: false, code: "not_found", message: expect.stringContaining("search_hotels again") });
  });
});

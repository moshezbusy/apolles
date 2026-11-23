import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierUnavailable } from "@/server/supplier/expedia/client";
import { MultiSupplierAdapter, boardKey, mergeOffers, roomTypeKey } from "./multi";
import type { AvailabilityQuery, Offer, PropertyOffers, SupplierAdapter } from "./types";

const QUERY: AvailabilityQuery = { propertyIds: ["1", "2"], checkin: "2027-04-10", checkout: "2027-04-12", occupancies: [{ adults: 2, childAges: [] }], countryCode: "IL" };

function offer(over: Partial<Offer> & { total: number }): Offer {
  const { total, ...rest } = over;
  const price = { total: { minor: total, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 };
  return {
    propertyId: "1",
    roomId: "r",
    roomName: "Deluxe Double Room",
    rateId: `rate-${total}`,
    refundable: true,
    bedGroups: [{ id: "b", description: "1 King Bed", priceCheckToken: `t-${total}` }],
    cancelPenalties: [{ start: "2027-04-08T00:00:00Z", end: "2027-04-10T00:00:00Z", amount: { minor: total, currency: "USD" }, nights: null, percent: null }],
    nonrefundableDateRanges: [],
    amenities: ["Free breakfast"],
    price,
    roomPrices: [price],
    ...rest,
  };
}

const adapter = (results: PropertyOffers[] | Error): SupplierAdapter => ({
  searchAvailability: async () => {
    if (results instanceof Error) throw results;
    return results;
  },
  priceCheck: async () => ({ status: "sold_out" }),
});

describe("merging offers of two suppliers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("room types match by name whatever the case, accents, punctuation, word order or the word room; boards by what the rate includes", () => {
    expect(roomTypeKey("Deluxe Double Room")).toBe(roomTypeKey("DOUBLE, deluxe"));
    expect(roomTypeKey("Chambre Supérieure")).toBe(roomTypeKey("chambre superieure"));
    expect(roomTypeKey("Deluxe Double")).not.toBe(roomTypeKey("Deluxe Twin"));
    expect(boardKey(["Free breakfast"])).toBe(boardKey(["Breakfast included"]));
    expect(boardKey(["Free WiFi"])).toBe("RO");
    expect(boardKey(["All inclusive"])).toBe("AI");
    expect(boardKey(["Half board"])).toBe("HB");
  });

  it("the same room, board and refundability from both suppliers: only the cheapest stays; a tie keeps the main supplier's", () => {
    const expedia = offer({ total: 30_000 });
    const hotelbeds = offer({ total: 25_000, roomName: "DOUBLE DELUXE", amenities: ["Breakfast included"], supplier: "hotelbeds" });
    expect(mergeOffers([expedia], [hotelbeds])).toEqual([hotelbeds]);
    const dearer = { ...hotelbeds, price: { ...hotelbeds.price, total: { minor: 31_000, currency: "USD" } } };
    expect(mergeOffers([expedia], [dearer])).toEqual([expedia]);
    const tie = { ...hotelbeds, price: { ...hotelbeds.price, total: { minor: 30_000, currency: "USD" } } };
    expect(mergeOffers([expedia], [tie])).toEqual([expedia]);
  });

  it("other terms stay as separate rates: another board, another refundability, another room; one supplier's own rates are never merged", () => {
    const expedia = offer({ total: 30_000 });
    const roomOnly = offer({ total: 20_000, amenities: [], supplier: "hotelbeds" });
    const nonRefundable = offer({ total: 21_000, refundable: false, supplier: "hotelbeds" });
    const twin = offer({ total: 22_000, roomName: "Deluxe Twin", supplier: "hotelbeds" });
    expect(mergeOffers([expedia], [roomOnly, nonRefundable, twin])).toEqual([expedia, roomOnly, nonRefundable, twin]);
    const sameAgain = offer({ total: 29_000, rateId: "other" });
    expect(mergeOffers([expedia, sameAgain], [])).toEqual([expedia, sameAgain]);
    // Two Expedia rates and a cheaper Hotelbeds one of the same terms: the agent sees one price.
    const cheaper = offer({ total: 10_000, supplier: "hotelbeds" });
    expect(mergeOffers([expedia, sameAgain], [cheaper])).toEqual([cheaper]);
  });

  it("the search asks both and merges per hotel; a hotel only the second supplier has is added", async () => {
    const expedia = offer({ total: 30_000 });
    const hotelbeds = offer({ total: 25_000, supplier: "hotelbeds" });
    const onlyThere = offer({ total: 40_000, propertyId: "2", supplier: "hotelbeds" });
    const multi = new MultiSupplierAdapter(adapter([{ propertyId: "1", offers: [expedia] }]), adapter([{ propertyId: "1", offers: [hotelbeds] }, { propertyId: "2", offers: [onlyThere] }]));
    expect(await multi.searchAvailability(QUERY, {})).toEqual([
      { propertyId: "1", offers: [hotelbeds] },
      { propertyId: "2", offers: [onlyThere] },
    ]);
  });

  it("the second supplier failing never fails the search; the main supplier failing does, as before", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const expedia = offer({ total: 30_000 });
    const multi = new MultiSupplierAdapter(adapter([{ propertyId: "1", offers: [expedia] }]), adapter(new SupplierUnavailable("down")));
    expect(await multi.searchAvailability(QUERY, {})).toEqual([{ propertyId: "1", offers: [expedia] }]);
    expect(console.error).toHaveBeenCalledWith("second supplier search skipped: SupplierUnavailable");
    const mainDown = new MultiSupplierAdapter(adapter(new SupplierUnavailable("down")), adapter([]));
    await expect(mainDown.searchAvailability(QUERY, {})).rejects.toBeInstanceOf(SupplierUnavailable);
  });
});

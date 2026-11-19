import { describe, expect, it } from "vitest";
import { FakeSupplierAdapter } from "./fake";
import type { Occupancy } from "./types";

const fake = new FakeSupplierAdapter();
const base = { propertyIds: ["101"], checkin: "2027-04-10", checkout: "2027-04-12", countryCode: "IL" };
const two: Occupancy = { adults: 2, childAges: [] };
const family: Occupancy = { adults: 2, childAges: [9, 4] };

async function offersFor(occupancies: Occupancy[]) {
  return (await fake.searchAvailability({ ...base, occupancies }))[0]!.offers;
}

describe("FakeSupplierAdapter, several rooms (plan 10)", () => {
  it("one room keeps exactly the prices it had before rooms were counted, whoever stays", async () => {
    // Recorded from the fake before plan 10 (property 101, 2 nights).
    const totals = [36000, 41625, 47250];
    for (const occupancy of [two, family, { adults: 5, childAges: [3] }]) {
      const offers = await offersFor([occupancy]);
      expect(offers.map((o) => o.price.total.minor)).toEqual(totals);
      for (const o of offers) expect(o.roomPrices).toEqual([o.price]);
    }
    const [first] = await offersFor([two]);
    expect(first!.price).toEqual({
      total: { minor: 36000, currency: "USD" },
      lines: [
        { kind: "room_rate", amount: { minor: 32000, currency: "USD" } },
        { kind: "taxes_and_fees", amount: { minor: 4000, currency: "USD" } },
      ],
      dueAtProperty: [],
      dueAtPropertyTotal: null,
      nights: 2,
    });
  });

  it("two rooms: one price per room, in room order; the total is their sum", async () => {
    const offers = await offersFor([two, family]);
    for (const o of offers) {
      expect(o.roomPrices).toHaveLength(2);
      expect(o.price.total.minor).toBe(o.roomPrices[0]!.total.minor + o.roomPrices[1]!.total.minor);
      expect(o.roomPrices[0]!.total.minor).not.toBe(o.roomPrices[1]!.total.minor); // different guests, different price
      const lines = o.price.lines.reduce((s, l) => s + l.amount.minor, 0);
      expect(lines).toBe(o.price.total.minor);
    }
    // Room 1 is priced as if it were alone.
    expect(offers.map((o) => o.roomPrices[0])).toEqual((await offersFor([two])).map((o) => o.price));
  });

  it("two identical rooms cost the same each", async () => {
    for (const o of await offersFor([family, family])) {
      expect(o.roomPrices[1]).toEqual(o.roomPrices[0]);
      expect(o.price.total.minor).toBe(2 * o.roomPrices[0]!.total.minor);
    }
  });

  it("fees at the property are added over the rooms", async () => {
    const suite = (await offersFor([two, family]))[2]!;
    expect(suite.price.dueAtPropertyTotal).toEqual({ minor: 8000, currency: "USD" });
    expect(suite.price.dueAtProperty).toEqual([{ kind: "resort_fee", amount: { minor: 8000, currency: "USD" }, localAmount: { minor: 7400, currency: "EUR" } }]);
  });

  it("the price check gives the same rooms' prices as the search", async () => {
    const offer = (await offersFor([two, family]))[1]!;
    const checked = await fake.priceCheck({
      propertyId: "101",
      roomId: offer.roomId,
      rateId: offer.rateId,
      token: offer.bedGroups[0]!.priceCheckToken,
      occupancies: [two, family],
    });
    expect(checked).toMatchObject({ status: "available", price: offer.price, roomPrices: offer.roomPrices });
  });
});

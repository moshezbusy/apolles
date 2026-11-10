import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { ExpediaAdapter, SupplierResponseInvalid, occupancyKey } from "./adapter";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const adapter = new ExpediaAdapter();
const context = { customerIp: "203.0.113.7", userAgent: "Mozilla/5.0", sessionId: "s1" };
const query = {
  propertyIds: ["19248"],
  checkin: "2027-02-10",
  checkout: "2027-02-12",
  occupancy: { adults: 2, childAges: [] },
  countryCode: "IL",
};

describe("ExpediaAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    await resetTestDb();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPEDIA_API_KEY", "k");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "s");
    vi.stubEnv("EXPEDIA_BASE_URL", "");
    vi.stubEnv("APP_ENV", "staging");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds Rapid's occupancy string", () => {
    expect(occupancyKey({ adults: 2, childAges: [] })).toBe("2");
    expect(occupancyKey({ adults: 1, childAges: [7, 10] })).toBe("1-7,10");
  });

  describe("searchAvailability", () => {
    it("sends the required parameters: point-of-sale country, USD, agent tool, hotel only", async () => {
      fetchMock.mockResolvedValue(json(200, []));
      await adapter.searchAvailability({ ...query, occupancy: { adults: 1, childAges: [7, 10] } }, context);
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe("/v3/properties/availability");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        checkin: "2027-02-10",
        checkout: "2027-02-12",
        currency: "USD",
        country_code: "IL",
        language: "en-US",
        occupancy: "1-7,10",
        property_id: "19248",
        rate_plan_count: "250",
        sales_channel: "agent_tool",
        sales_environment: "hotel_only",
      });
    });

    it("maps a USD-billed rate to an offer with the BP5 breakdown (total from Expedia, one Taxes and fees line)", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("availability.usd.json")));
      const [property] = await adapter.searchAvailability(query, context);
      expect(property?.propertyId).toBe("19248");
      const offer = property!.offers[0]!;
      expect(offer).toMatchObject({ roomId: expect.any(String), rateId: expect.any(String), refundable: expect.any(Boolean) });
      expect(offer.price.total).toEqual({ minor: 70200, currency: "USD" });
      expect(offer.price.nights).toBe(2);
      expect(offer.price.lines).toEqual([
        { kind: "room_rate", amount: { minor: 61800, currency: "USD" } },
        { kind: "taxes_and_fees", amount: { minor: 7400, currency: "USD" } },
        { kind: "extra_person_fee", amount: { minor: 1000, currency: "USD" } },
      ]);
      expect(offer.price.dueAtProperty).toEqual([
        { kind: "resort_fee", amount: { minor: 4320, currency: "USD" }, localAmount: { minor: 4000, currency: "EUR" } },
        { kind: "mandatory_tax", amount: { minor: 500, currency: "USD" }, localAmount: null },
      ]);
      expect(offer.price.dueAtPropertyTotal).toEqual({ minor: 4820, currency: "USD" });
      expect(offer.bedGroups[0]).toEqual({ id: "12345", description: "1 Queen Bed", priceCheckToken: "MY5S3j36cOcL" });
      expect(offer.cancelPenalties[0]).toMatchObject({ amount: { minor: 1000, currency: "USD" } });
    });

    it("drops rates billed in another currency (phase 1 wallets are USD only, BP5: no conversion)", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("availability.availability.json"))); // billed in CAD
      const result = await adapter.searchAvailability(query, context);
      expect(result.flatMap((p) => p.offers)).toHaveLength(0);
    });

    it("drops package rates and property-collect rates (AP4, GR5/BP8 do not apply to us)", async () => {
      const data = fixture("availability.usd.json") as { rooms: { rates: Record<string, unknown>[] }[] }[];
      const rate = data[0]!.rooms[0]!.rates[0]!;
      const pkg = structuredClone(data);
      (pkg[0]!.rooms[0]!.rates[0]!.sale_scenario as { package: boolean }).package = true;
      fetchMock.mockResolvedValueOnce(json(200, pkg));
      expect((await adapter.searchAvailability(query, context)).flatMap((p) => p.offers)).toHaveLength(0);

      rate.merchant_of_record = "property";
      fetchMock.mockResolvedValueOnce(json(200, data));
      expect((await adapter.searchAvailability(query, context)).flatMap((p) => p.offers)).toHaveLength(0);
    });

    it("returns no offers when nothing is available", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("availability.no-availability.json")));
      expect(await adapter.searchAvailability(query, context)).toEqual([]);
    });

    it("a malformed rate is dropped (never a half-priced offer) and the rest of the search still works", async () => {
      const good = (fixture("availability.usd.json") as Record<string, unknown>[])[0]!;
      const bad = structuredClone(good) as { property_id: string; rooms: { rates: { occupancy_pricing: Record<string, { totals?: unknown }> }[] }[] };
      bad.property_id = "999";
      for (const pricing of Object.values(bad.rooms[0]!.rates[0]!.occupancy_pricing)) delete pricing.totals;
      fetchMock.mockResolvedValue(json(200, [bad, good]));
      const result = await adapter.searchAvailability({ ...query, propertyIds: ["999", "19248"] }, context);
      expect(result.map((p) => p.propertyId)).toEqual(["19248"]);
      const row = await db.supplierCallLog.findFirstOrThrow();
      expect(row.unknownFields.some((name) => name.startsWith("invalid:"))).toBe(true);
    });

    it("a rate with a charge type we do not know is dropped, never summed into the wrong line", async () => {
      const data = fixture("availability.usd.json") as { rooms: { rates: { occupancy_pricing: Record<string, { stay?: { type: string }[] }> }[] }[] }[];
      for (const pricing of Object.values(data[0]!.rooms[0]!.rates[0]!.occupancy_pricing)) pricing.stay = [{ type: "brand_new_fee", value: "5.00", currency: "USD" } as never];
      fetchMock.mockResolvedValue(json(200, data));
      expect((await adapter.searchAvailability(query, context)).flatMap((p) => p.offers)).toHaveLength(0);
    });

    it("a local fee amount that will not parse drops only the local amount", async () => {
      const data = fixture("availability.usd.json") as { rooms: { rates: { occupancy_pricing: Record<string, { fees: { resort_fee: { billable_currency: { value: string; currency: string } } } }> }[] }[] }[];
      for (const pricing of Object.values(data[0]!.rooms[0]!.rates[0]!.occupancy_pricing)) pricing.fees.resort_fee.billable_currency = { value: "40.123", currency: "EUR" };
      fetchMock.mockResolvedValue(json(200, data));
      const [property] = await adapter.searchAvailability(query, context);
      expect(property!.offers[0]!.price.dueAtProperty[0]).toMatchObject({ kind: "resort_fee", localAmount: null });
    });

    it("a cancel penalty in another currency makes the rate unsellable", async () => {
      const data = fixture("availability.usd.json") as { rooms: { rates: { cancel_penalties: { currency: string }[] }[] }[] }[];
      data[0]!.rooms[0]!.rates[0]!.cancel_penalties[0]!.currency = "CAD";
      fetchMock.mockResolvedValue(json(200, data));
      expect((await adapter.searchAvailability(query, context)).flatMap((p) => p.offers)).toHaveLength(0);
    });

    it("a response that is not a list is a typed error", async () => {
      fetchMock.mockResolvedValue(json(200, { not: "a list" }));
      await expect(adapter.searchAvailability(query, context)).rejects.toBeInstanceOf(SupplierResponseInvalid);
    });

    it("drops unknown fields and records their names (not values) in the supplier log", async () => {
      const data = fixture("availability.usd.json") as Record<string, unknown>[];
      data[0]!.brand_new_field = "some value";
      fetchMock.mockResolvedValue(json(200, data));
      const [property] = await adapter.searchAvailability(query, context);
      expect(property!.offers.length).toBeGreaterThan(0);
      const row = await db.supplierCallLog.findFirstOrThrow();
      expect(row.unknownFields).toContain("brand_new_field");
    });

    it("refuses more than 250 properties in one call", async () => {
      await expect(
        adapter.searchAvailability({ ...query, propertyIds: Array.from({ length: 251 }, (_, i) => String(i)) }, context),
      ).rejects.toThrow(/250/);
    });
  });

  describe("priceCheck", () => {
    const ref = { propertyId: "19248", roomId: "abc123", rateId: "abc123", token: "MY5S3j36cOcL" };

    it("calls the price-check link with the token and returns the new breakdown and book token", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("price-check.usd-available.json")));
      const result = await adapter.priceCheck(ref, context);
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe("/v3/properties/19248/rooms/abc123/rates/abc123");
      expect(url.searchParams.get("token")).toBe("MY5S3j36cOcL");
      expect(result.status).toBe("available");
      if (result.status !== "sold_out") {
        expect(result.price.total).toEqual({ minor: 21500, currency: "USD" });
        expect(result.bookToken).toBe("Ql1WAERHXV1QO");
      }
    });

    it.each([
      ["roomId", { roomId: ".." }],
      ["rateId", { rateId: "a/b" }],
      ["token", { token: "x y" }],
    ])("refuses an unsafe %s before calling Expedia", async (_label, patch) => {
      await expect(adapter.priceCheck({ ...ref, ...patch }, context)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps price_changed and sold_out", async () => {
      const changed = fixture("price-check.usd-available.json") as Record<string, unknown>;
      changed.status = "price_changed";
      fetchMock.mockResolvedValueOnce(json(200, changed));
      expect((await adapter.priceCheck(ref, context)).status).toBe("price_changed");
      fetchMock.mockResolvedValueOnce(json(200, fixture("price-check.sold-out-example.json")));
      expect(await adapter.priceCheck(ref, context)).toEqual({ status: "sold_out" });
    });
  });
});

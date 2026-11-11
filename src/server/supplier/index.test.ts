import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpediaAdapter } from "./expedia/adapter";
import { ExpediaContentSource } from "./expedia/content";
import { FakeContentSource, FakeSupplierAdapter } from "./fake";
import { contentSource, supplierAdapter } from "./index";
import type { SupplierAdapter } from "./types";

const fake = (): SupplierAdapter => new FakeSupplierAdapter();

describe("supplier factory", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Expedia unless the fake supplier is asked for", () => {
    vi.stubEnv("SUPPLIER_MODE", "");
    expect(supplierAdapter()).toBeInstanceOf(ExpediaAdapter);
    expect(contentSource()).toBeInstanceOf(ExpediaContentSource);
  });

  it("the fake supplier works in development and tests", () => {
    vi.stubEnv("SUPPLIER_MODE", "fake");
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(supplierAdapter()).toBeInstanceOf(FakeSupplierAdapter);
    expect(contentSource()).toBeInstanceOf(FakeContentSource);
  });

  it.each([
    ["staging", "production"],
    ["production", "production"],
    ["", "production"],
  ])("the fake supplier is refused with APP_ENV=%s, NODE_ENV=%s", (appEnv, nodeEnv) => {
    vi.stubEnv("SUPPLIER_MODE", "fake");
    vi.stubEnv("APP_ENV", appEnv);
    vi.stubEnv("NODE_ENV", nodeEnv);
    expect(() => supplierAdapter()).toThrow(/fake supplier/);
    expect(() => contentSource()).toThrow(/fake supplier/);
  });

  it("an unknown mode is refused", () => {
    vi.stubEnv("SUPPLIER_MODE", "tbo");
    expect(() => supplierAdapter()).toThrow(/SUPPLIER_MODE/);
  });
});

describe("FakeSupplierAdapter", () => {
  const query = { propertyIds: ["101", "102"], checkin: "2027-04-10", checkout: "2027-04-12", occupancy: { adults: 2, childAges: [] }, countryCode: "IL" };

  it("gives every asked hotel the same offers each time: refundable, non-refundable, two bed types, fees at the property", async () => {
    const a = await fake().searchAvailability(query, {});
    const b = await fake().searchAvailability(query, {});
    expect(a).toEqual(b);
    expect(a.map((p) => p.propertyId)).toEqual(["101", "102"]);
    const offers = a[0]!.offers;
    expect(offers.some((o) => o.refundable)).toBe(true);
    expect(offers.some((o) => !o.refundable)).toBe(true);
    expect(offers.some((o) => o.bedGroups.length > 1)).toBe(true);
    expect(offers.some((o) => o.price.dueAtProperty.length > 0)).toBe(true);
    for (const o of offers) {
      expect(o.price.nights).toBe(2);
      expect(o.price.total.currency).toBe("USD");
      const sum = o.price.lines.reduce((s, l) => s + l.amount.minor, 0);
      expect(sum).toBe(o.price.total.minor); // the lines add up to the total
    }
  });

  it("price check is not available in the fake (booking comes in plan 3)", async () => {
    await expect(fake().priceCheck({ propertyId: "1", roomId: "r", rateId: "x", token: "t" }, {})).rejects.toThrow();
  });
});

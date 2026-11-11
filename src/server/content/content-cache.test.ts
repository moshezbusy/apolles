import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { SupplierTimeout } from "@/server/supplier/expedia/client";
import type { ContentSource, PropertyContent } from "@/server/supplier/types";
import { getContent } from "./content-cache";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const content = (id: string, name = `Hotel ${id}`): PropertyContent => ({
  propertyId: id,
  name,
  address: { line1: "1 Main", city: "Paris", stateProvince: null, postalCode: null, countryCode: "FR" },
  starRating: "4.0",
  coordinates: null,
  heroImage: null,
  images: [],
  amenities: [],
  checkin: { beginTime: null, endTime: null, instructions: null, specialInstructions: null, minAge: null },
  checkout: { time: null },
  fees: { mandatory: null, optional: null },
  knowBeforeYouGo: null,
  description: null,
  onsiteCurrency: null,
  rooms: [],
});

function source(impl: (ids: string[]) => Promise<PropertyContent[]>) {
  return { propertyContent: vi.fn(impl) } as unknown as ContentSource & { propertyContent: ReturnType<typeof vi.fn> };
}

describe("getContent", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("a fresh cache row is used without calling Expedia", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "1", data: content("1"), fetchedAt: hoursAgo(2) } });
    const s = source(async () => []);
    const map = await getContent(["1"], NOW, { source: s });
    expect(map.get("1")?.name).toBe("Hotel 1");
    expect(s.propertyContent).not.toHaveBeenCalled();
  });

  it("a stale row is fetched again and the cache updated", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "1", data: content("1", "Old"), fetchedAt: hoursAgo(30) } });
    const s = source(async () => [content("1", "New")]);
    const map = await getContent(["1"], NOW, { source: s });
    expect(map.get("1")?.name).toBe("New");
    const row = await db.propertyContentCache.findUniqueOrThrow({ where: { propertyId: "1" } });
    expect(row.fetchedAt).toEqual(NOW);
  });

  it("when Expedia fails, content up to 7 days old is still served", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "1", data: content("1", "Three days"), fetchedAt: hoursAgo(72) } });
    const map = await getContent(["1"], NOW, { source: source(async () => { throw new SupplierTimeout("t"); }) });
    expect(map.get("1")?.name).toBe("Three days");
  });

  it("content older than 7 days is not served even when Expedia fails", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "1", data: content("1"), fetchedAt: hoursAgo(8 * 24) } });
    const map = await getContent(["1"], NOW, { source: source(async () => { throw new SupplierTimeout("t"); }) });
    expect(map.has("1")).toBe(false);
  });

  it("600 missing hotels are fetched in 3 calls of at most 250", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => String(i + 1));
    const s = source(async (batch) => batch.map((id) => content(id)));
    const map = await getContent(ids, NOW, { source: s });
    expect(s.propertyContent.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([250, 250, 100]);
    expect(map.size).toBe(600);
  });

  it("a cached row that does not match the content shape is ignored and refetched", async () => {
    await db.propertyContentCache.create({ data: { propertyId: "1", data: { broken: true }, fetchedAt: hoursAgo(1) } });
    const s = source(async () => [content("1")]);
    const map = await getContent(["1"], NOW, { source: s });
    expect(map.get("1")?.name).toBe("Hotel 1");
    expect(s.propertyContent).toHaveBeenCalledTimes(1);
  });
});

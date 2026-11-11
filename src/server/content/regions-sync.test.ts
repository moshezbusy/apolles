import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { SupplierRateLimited } from "@/server/supplier/expedia/client";
import type { ContentSource, RegionInfo } from "@/server/supplier/types";
import { syncRegions } from "./regions-sync";

vi.mock("./scope", () => ({ CONTENT_COUNTRIES: ["FR", "IT"] }));

const region = (id: string, country: string, propertyIds: string[], name = `City ${id}`): RegionInfo => ({
  id,
  name,
  nameFull: `${name}, ${country}`,
  type: "city",
  countryCode: country,
  propertyIds,
});

function sourceWith(pages: Record<string, { regions: RegionInfo[]; next: string | null }[]>): ContentSource {
  return {
    listRegions: vi.fn(async ({ countryCode, next }: { countryCode: string; next?: string }) => {
      const list = pages[countryCode] ?? [{ regions: [], next: null }];
      const index = next ? Number(next.split("=")[1]) : 0;
      const page = list[index];
      if (!page) throw new Error("no such page");
      return page;
    }),
  } as unknown as ContentSource;
}

describe("syncRegions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("follows every page of every country", async () => {
    const source = sourceWith({
      FR: [
        { regions: [region("1", "FR", ["a", "b"])], next: "/regions?page=1" },
        { regions: [region("2", "FR", ["c"])], next: null },
      ],
      IT: [{ regions: [region("3", "IT", [])], next: null }],
    });
    const result = await syncRegions({ source });
    expect(result.destinations).toBe(3);
    expect(await db.destination.count({ where: { active: true } })).toBe(3);
    const one = await db.destination.findUniqueOrThrow({ where: { id: "1" } });
    expect(one).toMatchObject({ name: "City 1", countryCode: "FR", type: "city", propertyCount: 2 });
    expect(await db.contentSyncRun.findFirstOrThrow()).toMatchObject({ kind: "content.regions", status: "DONE" });
  });

  it("replaces a region's hotel list when it shrinks", async () => {
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", ["a", "b", "c"])], next: null }] }) });
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", ["b"])], next: null }] }) });
    const links = await db.destinationProperty.findMany({ where: { destinationId: "1" } });
    expect(links.map((l) => l.propertyId)).toEqual(["b"]);
    expect((await db.destination.findUniqueOrThrow({ where: { id: "1" } })).propertyCount).toBe(1);
  });

  it("a region missing from the next run becomes inactive", async () => {
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", []), region("2", "FR", [])], next: null }] }) });
    const result = await syncRegions({ source: sourceWith({ FR: [{ regions: [region("2", "FR", [])], next: null }] }) });
    expect(result.deactivated).toBe(1);
    expect((await db.destination.findUniqueOrThrow({ where: { id: "1" } })).active).toBe(false);
  });

  it("a rate limit on the second country fails the run and deactivates nothing", async () => {
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", [])], next: null }], IT: [{ regions: [region("3", "IT", [])], next: null }] }) });
    const source = {
      listRegions: vi.fn(async ({ countryCode }: { countryCode: string }) => {
        if (countryCode === "IT") throw new SupplierRateLimited("429", 429);
        return { regions: [region("1", "FR", [])], next: null };
      }),
    } as unknown as ContentSource;
    await expect(syncRegions({ source })).rejects.toBeInstanceOf(SupplierRateLimited);
    expect(await db.destination.count({ where: { active: true } })).toBe(2);
    expect(await db.contentSyncRun.count({ where: { kind: "content.regions", status: "FAILED" } })).toBe(1);
  });

  it("a country that suddenly returns no regions fails the run and deactivates nothing", async () => {
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", ["a"])], next: null }] }) });
    await expect(syncRegions({ source: sourceWith({ FR: [{ regions: [], next: null }] }) })).rejects.toThrow(/refusing/);
    expect((await db.destination.findUniqueOrThrow({ where: { id: "1" } })).active).toBe(true);
  });

  it("two syncs of the same kind never run at once", async () => {
    await db.contentSyncRun.create({ data: { kind: "content.regions" } });
    await expect(syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", [])], next: null }] }) })).rejects.toThrow(/already running/);
  });

  it("stops following pages if the supplier loops", async () => {
    const source = { listRegions: vi.fn(async () => ({ regions: [], next: "/regions?page=1" })) } as unknown as ContentSource;
    await expect(syncRegions({ source })).rejects.toThrow(/pages/);
  });
});

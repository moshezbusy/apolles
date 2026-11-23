import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { SupplierTimeout } from "@/server/supplier/expedia/client";
import type { ContentSource } from "@/server/supplier/types";
import { syncInactive } from "./inactive-sync";

const NOW = new Date("2027-03-01T10:00:00.000Z");

async function hotel(id: string) {
  await db.property.create({ data: { id, name: id, city: "Paris", countryCode: "FR", expediaCollect: true, catalogSeenRunId: "r" } });
  await db.propertyContentCache.create({ data: { propertyId: id, data: {}, fetchedAt: NOW } });
}

describe("syncInactive", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("marks listed hotels inactive, deletes their cached content, and follows pages", async () => {
    await hotel("1");
    await hotel("2");
    await hotel("3");
    const inactiveSince = vi.fn(async ({ next }: { since: string; next?: string }) =>
      next ? { propertyIds: ["2"], next: null } : { propertyIds: ["1"], next: "/properties/inactive?token=t" },
    );
    const result = await syncInactive(NOW, { source: { inactiveSince } as unknown as ContentSource });
    expect(result.deactivated).toBe(2);
    expect((await db.property.findUniqueOrThrow({ where: { id: "3" } })).active).toBe(true);
    expect(await db.propertyContentCache.count()).toBe(1);
    expect(inactiveSince.mock.calls[0]![0]).toEqual({ since: "2027-02-28" });
  });

  it("a page that times out is asked for again; with the demo supplier the sync does nothing", async () => {
    await hotel("1");
    let calls = 0;
    const inactiveSince = vi.fn(async () => {
      if (++calls === 1) throw new SupplierTimeout("timed out");
      return { propertyIds: ["1"], next: null };
    });
    const sleep = vi.fn(async () => undefined);
    expect(await syncInactive(NOW, { source: { inactiveSince } as unknown as ContentSource, sleep })).toEqual({ deactivated: 1 });
    expect(sleep).toHaveBeenCalledTimes(1);

    vi.stubEnv("SUPPLIER_MODE", "fake");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const runs = await db.contentSyncRun.count();
      expect(await syncInactive(NOW)).toEqual({ deactivated: 0 });
      expect(await db.contentSyncRun.count()).toBe(runs);
    } finally {
      info.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("starts from the start of the last successful run", async () => {
    await db.contentSyncRun.create({ data: { kind: "content.inactive", status: "DONE", startedAt: new Date("2027-02-20T02:00:00Z") } });
    const inactiveSince = vi.fn<ContentSource["inactiveSince"]>(async () => ({ propertyIds: [], next: null }));
    await syncInactive(NOW, { source: { inactiveSince } as unknown as ContentSource });
    expect(inactiveSince.mock.calls[0]![0]).toEqual({ since: "2027-02-20" });
  });
});

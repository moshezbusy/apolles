import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { SupplierRateLimited, SupplierRequestRejected, SupplierTimeout } from "@/server/supplier/expedia/client";
import type { ContentSource, RegionInfo } from "@/server/supplier/types";
import { syncRegions } from "./regions-sync";
import { SyncRunTakenOver, startSyncRun, touchSyncRun } from "./sync-run";

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
    const waits: number[] = [];
    await expect(syncRegions({ source, sleep: async (ms) => void waits.push(ms) })).rejects.toBeInstanceOf(SupplierRateLimited);
    expect(waits).toEqual([2_000, 4_000]); // three tries in all, then the run gives up
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

  it("one timeout or rate limit on a page is tried again (waiting as long as Expedia asks), and the run goes on", async () => {
    const limited = new SupplierRateLimited("429", 429);
    limited.retryAfterMs = 7_000;
    const failures: Error[] = [new SupplierTimeout("timed out"), limited];
    const listRegions = vi.fn(async ({ countryCode }: { countryCode: string }) => {
      const failure = countryCode === "FR" ? failures.shift() : undefined;
      if (failure) throw failure;
      return { regions: [region(countryCode === "FR" ? "1" : "3", countryCode, [])], next: null };
    });
    const waits: number[] = [];
    const result = await syncRegions({ source: { listRegions } as unknown as ContentSource, sleep: async (ms) => void waits.push(ms) });
    expect(result.destinations).toBe(2);
    expect(waits).toEqual([2_000, 7_000]);
    expect(await db.contentSyncRun.findFirstOrThrow()).toMatchObject({ status: "DONE" });
  });

  it("an error that trying again cannot fix (a rejected request) is not retried", async () => {
    const listRegions = vi.fn(async () => {
      throw new SupplierRequestRejected("400", 400);
    });
    const sleep = vi.fn(async () => undefined);
    await expect(syncRegions({ source: { listRegions } as unknown as ContentSource, sleep })).rejects.toBeInstanceOf(SupplierRequestRejected);
    expect(listRegions).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a region with more hotel links than one statement takes is stored whole", async () => {
    const ids = Array.from({ length: 10_500 }, (_, i) => `h${i}`);
    await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", ids)], next: null }] }) });
    expect(await db.destinationProperty.count({ where: { destinationId: "1" } })).toBe(10_500);
    expect((await db.destination.findUniqueOrThrow({ where: { id: "1" } })).propertyCount).toBe(10_500);
  });

  describe("a run with no sign of life", () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

    it("for 10 minutes (a worker that restarted) is closed, and the next try takes over the same day", async () => {
      const dead = await db.contentSyncRun.create({ data: { kind: "content.regions", startedAt: minutesAgo(40), heartbeatAt: minutesAgo(11) } });
      const result = await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", [])], next: null }] }) });
      expect(result.destinations).toBe(1);
      expect((await db.contentSyncRun.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe("FAILED");
      expect(await db.contentSyncRun.count({ where: { kind: "content.regions", status: "DONE" } })).toBe(1);
    });

    it("a run that showed life a minute ago still blocks a second one, however long ago it started", async () => {
      await db.contentSyncRun.create({ data: { kind: "content.regions", startedAt: minutesAgo(90), heartbeatAt: minutesAgo(1) } });
      await expect(syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", [])], next: null }] }) })).rejects.toThrow(/already running/);
    });

    it("a run from before the heartbeat existed is judged by when it started", async () => {
      await db.contentSyncRun.create({ data: { kind: "content.regions", startedAt: minutesAgo(11) } });
      await expect(syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", [])], next: null }] }) })).resolves.toMatchObject({ destinations: 1 });
    });

    it("the old run, if it wakes up after a takeover, is stopped before it deactivates anything", async () => {
      await syncRegions({ source: sourceWith({ FR: [{ regions: [region("1", "FR", []), region("2", "FR", [])], next: null }] }) });
      // The old run asks for its page, then hangs; meanwhile it is closed as dead and a new run starts.
      const listRegions = vi.fn(async ({ countryCode }: { countryCode: string }) => {
        if (countryCode === "FR") {
          await db.contentSyncRun.updateMany({ where: { status: "RUNNING" }, data: { heartbeatAt: minutesAgo(11) } });
          await startSyncRun("content.regions");
        }
        return { regions: countryCode === "FR" ? [region("2", "FR", [])] : [], next: null };
      });
      await expect(syncRegions({ source: { listRegions } as unknown as ContentSource })).rejects.toBeInstanceOf(SyncRunTakenOver);
      expect((await db.destination.findUniqueOrThrow({ where: { id: "1" } })).active).toBe(true);
      expect(await db.contentSyncRun.count({ where: { status: "RUNNING" } })).toBe(1); // the newer run, untouched
    });

    it("touchSyncRun moves the heartbeat of a running run only", async () => {
      const run = await startSyncRun("content.catalog");
      await db.contentSyncRun.update({ where: { id: run.id }, data: { heartbeatAt: minutesAgo(5) } });
      await touchSyncRun(run.id);
      expect((await db.contentSyncRun.findUniqueOrThrow({ where: { id: run.id } })).heartbeatAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
      await db.contentSyncRun.update({ where: { id: run.id }, data: { status: "FAILED" } });
      await expect(touchSyncRun(run.id)).rejects.toBeInstanceOf(SyncRunTakenOver);
    });
  });

  describe("with the demo supplier (SUPPLIER_MODE=fake)", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("does nothing and says so, instead of calling Expedia and failing", async () => {
      vi.stubEnv("SUPPLIER_MODE", "fake");
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchMock);
      try {
        expect(await syncRegions()).toEqual({ destinations: 0, deactivated: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(await db.contentSyncRun.count()).toBe(0);
        expect(info.mock.calls[0]?.[0]).toMatch(/content\.regions sync skipped: the demo supplier is on/);
      } finally {
        info.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  });

  it("stops following pages if the supplier loops", async () => {
    const source = { listRegions: vi.fn(async () => ({ regions: [], next: "/regions?page=1" })) } as unknown as ContentSource;
    await expect(syncRegions({ source })).rejects.toThrow(/pages/);
  });
});

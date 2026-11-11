import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import type { ContentSource } from "@/server/supplier/types";
import { syncCatalog } from "./catalog-sync";
import { openCatalogStream } from "./download";

function line(id: string, country: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    property_id: id,
    name: `Hotel ${id}`,
    address: { line_1: "1 Main St", city: "Paris", country_code: country },
    ratings: { property: { rating: "4.5", type: "Star" } },
    location: { coordinates: { latitude: 48.8566, longitude: 2.3522 } },
    rank: Number(id),
    business_model: { expedia_collect: true, property_collect: false },
    phone: "1-2-3",
    ...extra,
  });
}

async function* lines(items: string[], failAfter?: number): AsyncIterable<string> {
  let n = 0;
  for (const item of items) {
    if (failAfter !== undefined && n === failAfter) throw new Error("connection reset");
    n++;
    yield item;
  }
}

const source = { catalogLink: async () => ({ href: "https://files.example/catalog.jsonl.gz" }) } as unknown as ContentSource;

describe("syncCatalog", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("stores hotels in the content countries, skips others and malformed lines", async () => {
    const result = await syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR"), line("3", "JP"), "{not json"]) });
    expect(result).toMatchObject({ upserted: 2, skippedCountry: 1, invalid: 1, deactivated: 0 });
    const hotel = await db.property.findUniqueOrThrow({ where: { id: "1" } });
    expect(hotel).toMatchObject({ name: "Hotel 1", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true });
    expect(hotel.starRating?.toString()).toBe("4.5");
    expect(hotel.latitude?.toString()).toBe("48.8566");
    const run = await db.contentSyncRun.findFirstOrThrow();
    expect(run).toMatchObject({ kind: "content.catalog", status: "DONE" });
  });

  it("a hotel missing from the next full file becomes inactive; the others stay active", async () => {
    await syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR")]) });
    const result = await syncCatalog({ source, open: async () => lines([line("2", "FR")]) });
    expect(result.deactivated).toBe(1);
    expect((await db.property.findUniqueOrThrow({ where: { id: "1" } })).active).toBe(false);
    expect((await db.property.findUniqueOrThrow({ where: { id: "2" } })).active).toBe(true);
  });

  it("a download that breaks halfway deactivates nothing and records the run as FAILED", async () => {
    await syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR"), line("3", "FR")]) });
    await expect(syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR"), line("3", "FR")], 2) })).rejects.toThrow(
      "connection reset",
    );
    expect(await db.property.count({ where: { active: true } })).toBe(3);
    expect(await db.contentSyncRun.count({ where: { status: "FAILED" } })).toBe(1);
  });

  it("an empty catalog file deactivates nothing and fails the run", async () => {
    await syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR")]) });
    await expect(syncCatalog({ source, open: async () => lines([]) })).rejects.toThrow(/refusing/);
    expect(await db.property.count({ where: { active: true } })).toBe(2);
    expect(await db.contentSyncRun.count({ where: { status: "FAILED" } })).toBe(1);
  });

  it("a file with far fewer hotels than before (a broken or partial file) deactivates nothing", async () => {
    await syncCatalog({ source, open: async () => lines(Array.from({ length: 10 }, (_, i) => line(String(i + 1), "FR"))) });
    await expect(syncCatalog({ source, open: async () => lines([line("1", "FR"), line("2", "FR")]) })).rejects.toThrow(/refusing/);
    expect(await db.property.count({ where: { active: true } })).toBe(10);
  });

  it("a file whose lines are mostly invalid (a format change) deactivates nothing", async () => {
    await syncCatalog({ source, open: async () => lines([line("1", "FR")]) });
    const broken = Array.from({ length: 200 }, () => "{\"property_id\":\"x\"}");
    await expect(syncCatalog({ source, open: async () => lines([line("1", "FR"), ...broken]) })).rejects.toThrow(/refusing/);
    expect((await db.property.findUniqueOrThrow({ where: { id: "1" } })).active).toBe(true);
  });

  it("strips NUL characters and refuses an impossible rank instead of failing the batch", async () => {
    const result = await syncCatalog({
      source,
      open: async () => lines([line("1", "FR", { name: "Bad\u0000Name" }), line("2", "FR", { rank: 3_000_000_000 }), line("3", "FR")]),
    });
    expect(result).toMatchObject({ upserted: 2, invalid: 1 });
    expect((await db.property.findUniqueOrThrow({ where: { id: "1" } })).name).toBe("BadName");
  });

  it("records whether Expedia collects payment for the hotel", async () => {
    await syncCatalog({
      source,
      open: async () => lines([line("1", "FR", { business_model: { expedia_collect: false, property_collect: true } })]),
    });
    expect((await db.property.findUniqueOrThrow({ where: { id: "1" } })).expediaCollect).toBe(false);
  });

  it("the same hotel twice in one batch is stored once", async () => {
    const result = await syncCatalog({ source, open: async () => lines([line("1", "FR"), line("1", "FR")]) });
    expect(result.upserted).toBe(1);
    expect(await db.property.count()).toBe(1);
  });

  it("handles more than one batch (1,000 rows each)", async () => {
    const many = Array.from({ length: 2_345 }, (_, i) => line(String(i + 1), "FR"));
    const result = await syncCatalog({ source, open: async () => lines(many) });
    expect(result.upserted).toBe(2_345);
    expect(await db.property.count()).toBe(2_345);
  });
});

describe("openCatalogStream", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["http://files.example/c.gz", "https://127.0.0.1/c.gz", "https://localhost/c.gz", "https://[::1]/c.gz", "file:///etc/passwd"])(
    "refuses %s",
    async (href) => {
      await expect(openCatalogStream(href)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("gunzips and yields one line at a time, with no Authorization header on the download", async () => {
    fetchMock.mockResolvedValue(new Response(gzipSync(Buffer.from(`${line("1", "FR")}\n${line("2", "FR")}\n`)), { status: 200 }));
    const out: string[] = [];
    for await (const l of await openCatalogStream("https://files.example/c.jsonl.gz")) out.push(l);
    expect(out).toHaveLength(2);
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("a connection that breaks in the middle of the download is an error, not a crash", async () => {
    const gz = gzipSync(Buffer.from(`${line("1", "FR")}\n${line("2", "FR")}\n`));
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(gz.subarray(0, 10));
        controller.error(new Error("socket hang up"));
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const read = async () => {
      for await (const _ of await openCatalogStream("https://files.example/c.jsonl.gz")) void _;
    };
    await expect(read()).rejects.toThrow();
  });

  it("refuses a line longer than the limit (a file with no line breaks)", async () => {
    fetchMock.mockResolvedValue(new Response(gzipSync(Buffer.from("x".repeat(3_000_000))), { status: 200 }));
    const read = async () => {
      for await (const _ of await openCatalogStream("https://files.example/c.jsonl.gz")) void _;
    };
    await expect(read()).rejects.toThrow(/line/);
  });

  it("refuses localhost with a trailing dot and single-label internal names", async () => {
    for (const href of ["https://localhost./c.gz", "https://apolles-staging-db/c.gz"]) await expect(openCatalogStream(href)).rejects.toThrow();
  });

  it("a non-200 download is an error", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(openCatalogStream("https://files.example/c.jsonl.gz")).rejects.toThrow(/403/);
  });
});

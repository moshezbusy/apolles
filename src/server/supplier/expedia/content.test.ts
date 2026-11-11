import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { nextFromLink } from "./client";
import { ExpediaContentSource } from "./content";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
}
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const source = new ExpediaContentSource();

describe("nextFromLink (Rapid paging)", () => {
  it("returns the next page as path and query, kept exactly as given", () => {
    expect(nextFromLink('<https://test.ean.com/v3/regions?token=tok-ex&include=details>; rel="next"; expires="2027-01-01"', "https://test.ean.com/v3")).toBe(
      "/regions?token=tok-ex&include=details",
    );
  });

  it("a next URL that contains a comma is read whole", () => {
    expect(nextFromLink('<https://test.ean.com/v3/regions?token=a,b&x=1>; rel="next"', "https://test.ean.com/v3")).toBe("/regions?token=a,b&x=1");
  });

  it("a Link header with a next relation that cannot be read is an error, never 'no more pages'", () => {
    expect(() => nextFromLink('rel="next"; garbage', "https://test.ean.com/v3")).toThrow();
  });

  it("no header, no next relation → null", () => {
    expect(nextFromLink(null, "https://test.ean.com/v3")).toBeNull();
    expect(nextFromLink('<https://test.ean.com/v3/regions?token=a>; rel="prev"', "https://test.ean.com/v3")).toBeNull();
  });

  it("refuses a next link to another host or outside /v3 (the signed request must stay with Expedia)", () => {
    expect(() => nextFromLink('<https://evil.example/v3/regions?token=a>; rel="next"', "https://test.ean.com/v3")).toThrow();
    expect(() => nextFromLink('<https://test.ean.com/admin?x=1>; rel="next"', "https://test.ean.com/v3")).toThrow();
  });
});

describe("ExpediaContentSource", () => {
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

  describe("listRegions", () => {
    it("asks for details and property ids of cities and multi-city areas in one country", async () => {
      fetchMock.mockResolvedValue(json(200, []));
      await source.listRegions({ countryCode: "FR" });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe("/v3/regions");
      expect(url.searchParams.getAll("include")).toEqual(["details", "property_ids"]);
      expect(url.searchParams.getAll("type")).toEqual(["city", "multi_city_vicinity"]);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ country_code: "FR", language: "en-US", supply_source: "expedia" });
    });

    it("maps regions and returns the next page from the Link header", async () => {
      const regions = fixture("regions.regions.json") as Record<string, unknown>[];
      regions[0]!.property_ids = ["1", "2"];
      regions[0]!.type = "city";
      fetchMock.mockResolvedValue(json(200, regions, { Link: '<https://test.ean.com/v3/regions?token=tok-ex>; rel="next"' }));
      const page = await source.listRegions({ countryCode: "US" });
      expect(page.next).toBe("/regions?token=tok-ex");
      expect(page.regions[0]).toMatchObject({ id: String(regions[0]!.id), name: regions[0]!.name, type: "city", propertyIds: ["1", "2"] });
    });

    it("follows a next page exactly as given", async () => {
      fetchMock.mockResolvedValue(json(200, []));
      await source.listRegions({ countryCode: "US", next: "/regions?token=tok-ex&include=details" });
      expect(String(fetchMock.mock.calls[0]![0])).toBe("https://test.ean.com/v3/regions?token=tok-ex&include=details");
    });

    it("skips a region of another type or missing its name, and keeps the rest", async () => {
      fetchMock.mockResolvedValue(
        json(200, [
          { id: "1", type: "city", name: "Paris", name_full: "Paris, France", country_code: "FR", property_ids: ["9"] },
          { id: "2", type: "airport", name: "CDG", name_full: "CDG", country_code: "FR" },
          { id: "3", type: "city", name_full: "No name", country_code: "FR" },
        ]),
      );
      const page = await source.listRegions({ countryCode: "FR" });
      expect(page.regions.map((r) => r.id)).toEqual(["1"]);
    });
  });

  describe("propertyContent", () => {
    it("refuses more than 250 ids before any call", async () => {
      await expect(source.propertyContent(Array.from({ length: 251 }, (_, i) => String(i)))).rejects.toThrow(/250/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("maps the official example: name, star rating as given, check-in texts and fees, images, rooms", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("content.multiple.json")));
      const result = await source.propertyContent(["12345", "67890"]);
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.searchParams.getAll("property_id")).toEqual(["12345", "67890"]);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ language: "en-US", supply_source: "expedia" });

      const p = result.find((c) => c.propertyId === "12345")!;
      expect(p.name).toEqual(expect.any(String));
      expect(p.starRating).toMatch(/^\d(\.\d)?$/);
      expect(p.checkin.instructions).toContain("Government-issued photo identification");
      expect(p.checkin.minAge).toBe(18);
      expect(p.fees.mandatory).toContain("Resort fee");
      expect(p.coordinates).toEqual({ lat: "37.158451", lng: "-93.268382" });
      expect(p.images[0]!.url).toMatch(/^https:\/\//);
      expect(p.heroImage).not.toBeNull();
      expect(p.rooms.length).toBeGreaterThan(0);
      expect(p.rooms[0]!.maxOccupancy).toBe(5);
    });

    it("drops an image that is not https and keeps the property", async () => {
      const data = fixture("content.multiple.json") as Record<string, { images: { links: Record<string, { href: string }> }[] }>;
      for (const image of data["12345"]!.images) for (const link of Object.values(image.links)) link.href = link.href.replace("https://", "http://");
      fetchMock.mockResolvedValue(json(200, data));
      const result = await source.propertyContent(["12345"]);
      const p = result.find((c) => c.propertyId === "12345")!;
      expect(p.images).toEqual([]);
      expect(p.heroImage).toBeNull();
    });

    it("skips a property missing its name, returns the others, and names it in the log", async () => {
      const data = fixture("content.multiple.json") as Record<string, Record<string, unknown>>;
      delete data["67890"]!.name;
      fetchMock.mockResolvedValue(json(200, data));
      const result = await source.propertyContent(["12345", "67890"]);
      expect(result.map((c) => c.propertyId)).toEqual(["12345"]);
      const row = await db.supplierCallLog.findFirstOrThrow();
      expect(row.unknownFields.some((name) => name.startsWith("invalid:67890"))).toBe(true);
    });
  });

  describe("catalogLink", () => {
    it("returns the download link", async () => {
      fetchMock.mockResolvedValue(json(200, { method: "GET", href: "https://files.example/catalog.jsonl.gz", expires: "2027-01-01T00:00:00Z" }));
      expect(await source.catalogLink()).toEqual({ href: "https://files.example/catalog.jsonl.gz" });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe("/v3/files/properties/catalog");
    });

    it("does not store the signed download link in the supplier log", async () => {
      fetchMock.mockResolvedValue(json(200, { method: "GET", href: "https://files.example/catalog.jsonl.gz?sig=abc", expires: "2027-01-01T00:00:00Z" }));
      await source.catalogLink();
      const row = await db.supplierCallLog.findFirstOrThrow();
      expect(JSON.stringify(row.responseBody ?? null)).not.toContain("files.example");
    });
  });

  describe("inactiveSince", () => {
    it("returns the property ids and the next page", async () => {
      fetchMock.mockResolvedValue(json(200, fixture("inactive.json")));
      expect(await source.inactiveSince({ since: "2027-02-28" })).toEqual({ propertyIds: ["12345", "23456"], next: null });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.searchParams.get("since")).toBe("2027-02-28");
    });
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { safeReturnTo } from "@/server/auth/return-to";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "TestBrowser/1.0", "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

const IN = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const OUT = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);

function params(over: Record<string, string> = {}): Promise<Record<string, string>> {
  return Promise.resolve({ dest: "Hotel 11", type: "hotel", in: IN, out: OUT, rooms: "2-5-9,2", nat: "Israel", hotel: "11", destId: "paris", ...over });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const FIELDS = { hotel: "11", destId: "paris", in: IN, out: OUT, rooms: "2-5-9,2" };

describe("result link page /search/open (plan 11, design §6)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    vi.mocked(requireAgent).mockReset();
    vi.mocked(requireAgent).mockResolvedValue({ userId: "user-1", agencyId: "A", sessionId: "s-1" });
    await db.agency.create({ data: { id: "A", name: "Agency A", country: "IL", bankReference: "APL-A" } });
    await db.destination.create({
      data: { id: "paris", name: "Paris", nameFull: "Paris, Ile-de-France, France", type: "city", countryCode: "FR", propertyCount: 2, seenRunId: "r" },
    });
    for (const id of ["11", "12"]) {
      await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", starRating: "4.0", rank: Number(id), expediaCollect: true, active: id === "11", catalogSeenRunId: "r" } });
      await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: id } });
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows the stay and a Show rates button, and runs no search", async () => {
    const { default: Page } = await import("./(link)/search/open/page");
    const html = renderToStaticMarkup(await Page({ searchParams: params({ dest: "Evil name" }) }));
    expect(html).toContain("Hotel 11"); // from the database, not from `dest`
    expect(html).not.toContain("Evil name");
    expect(html).toContain("Paris");
    expect(html).toContain("2 nights");
    expect(html).toContain("2 rooms");
    expect(html).toContain("4 adults, 2 children");
    expect(html).toContain("Israel");
    expect(html).toContain("Prices are checked again now. They may differ from what the assistant showed.");
    expect(html).toContain("Show rates");
    expect(html).toContain('name="hotel" value="11"');
    expect(await db.searchSnapshot.count()).toBe(0);
    expect(await db.searchHotel.count()).toBe(0);
  });

  it("a bad rooms text or bad dates gives the search page message with a link to /search", async () => {
    const { default: Page } = await import("./(link)/search/open/page");
    for (const over of [{ rooms: "0" }, { rooms: "x" }, { in: "2027-02-30" }, { out: IN }, { hotel: "a b" }, { destId: "" }]) {
      const html = renderToStaticMarkup(await Page({ searchParams: params(over) }));
      expect(html).toContain("Check the destination, dates and guests.");
      expect(html).toContain('href="/search"');
      expect(html).not.toContain("Show rates");
    }
  });

  it("an inactive or unknown hotel is not offered", async () => {
    const { default: Page } = await import("./(link)/search/open/page");
    for (const hotel of ["12", "999"]) {
      const html = renderToStaticMarkup(await Page({ searchParams: params({ hotel }) }));
      expect(html).toContain("This hotel can no longer be booked. Choose another hotel.");
      expect(html).toContain('href="/search"');
      expect(html).not.toContain("Show rates");
    }
  });

  it("a signed-out agent is sent to sign in and comes back to the same link", async () => {
    vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    const { default: Page } = await import("./(link)/search/open/page");
    await expect(Page({ searchParams: params() })).rejects.toThrow("NEXT_REDIRECT:/login");
    const returnTo = vi.mocked(requireAgent).mock.calls[0]![0]!.returnTo!;
    expect(returnTo.startsWith("/search/open?")).toBe(true);
    expect(safeReturnTo(returnTo)).toBe(returnTo);
    expect(new URLSearchParams(returnTo.split("?")[1]).get("hotel")).toBe("11");
    expect(new URLSearchParams(returnTo.split("?")[1]).get("rooms")).toBe("2-5-9,2");
  });

  it("shows the message of a failed attempt together with the form", async () => {
    const { default: Page } = await import("./(link)/search/open/page");
    const html = renderToStaticMarkup(await Page({ searchParams: params({ notice: "ratelimited" }) }));
    expect(html).toContain("Too many searches. Wait a minute and try again.");
    expect(html).toContain("Show rates");
  });
});

describe("Show rates action", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    vi.mocked(requireAgent).mockReset();
    vi.mocked(requireAgent).mockResolvedValue({ userId: "user-1", agencyId: "A", sessionId: "s-1" });
    await db.agency.create({ data: { id: "A", name: "Agency A", country: "IL", bankReference: "APL-A" } });
    await db.destination.create({
      data: { id: "paris", name: "Paris", nameFull: "Paris, Ile-de-France, France", type: "city", countryCode: "FR", propertyCount: 2, seenRunId: "r" },
    });
    for (const id of ["11", "12"]) {
      await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", rank: Number(id), expediaCollect: true, active: id === "11", catalogSeenRunId: "r" } });
      await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: id } });
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("searches the one hotel and opens its page", async () => {
    const { showRatesAction } = await import("./(link)/search/open/actions");
    await expect(showRatesAction(form(FIELDS))).rejects.toThrow(/^NEXT_REDIRECT:\/search\/[a-z0-9]+\/hotels\/11$/);
    const snapshot = await db.searchSnapshot.findFirstOrThrow();
    expect(snapshot).toMatchObject({ agencyId: "A", source: "WEB" });
    expect(snapshot.candidateIds).toEqual(["11"]);
    expect(snapshot.query).toMatchObject({ destinationId: "paris", rooms: [{ adults: 2, childAges: [5, 9] }, { adults: 2, childAges: [] }] });
  });

  it("an inactive hotel goes back to the page with the invalid notice and searches nothing", async () => {
    const { showRatesAction } = await import("./(link)/search/open/actions");
    await expect(showRatesAction(form({ ...FIELDS, hotel: "12" }))).rejects.toThrow(/^NEXT_REDIRECT:\/search\/open\?.*notice=invalid/);
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("bad fields never reach the supplier", async () => {
    const { showRatesAction } = await import("./(link)/search/open/actions");
    await expect(showRatesAction(form({ ...FIELDS, rooms: "9" }))).rejects.toThrow(/NEXT_REDIRECT:\/search\/open\?notice=invalid$/);
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("requires an agent session", async () => {
    vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    const { showRatesAction } = await import("./(link)/search/open/actions");
    await expect(showRatesAction(form(FIELDS))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await db.searchSnapshot.count()).toBe(0);
  });
});

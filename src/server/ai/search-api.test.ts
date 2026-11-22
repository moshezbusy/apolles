import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { exchangeCode, issueAuthCode, verifyAiToken } from "@/server/ai/tokens";
import { aiRates, aiSearch, type AiAuth } from "@/server/ai/search-api";
import { ExpediaAdapter } from "@/server/supplier/expedia/adapter";
import { SupplierRateLimited } from "@/server/supplier/expedia/client";
import type { AvailabilityQuery, Offer, PropertyOffers, SupplierAdapter, SupplierContext } from "@/server/supplier/types";
import * as searchRoute from "@/app/api/ai/v1/search/route";
import * as ratesRoute from "@/app/api/ai/v1/rates/route";
import { callTool } from "@/mcp/tools";

// The token check is wrapped in a spy (same behaviour), to see that a wrong service key is refused
// before any token is looked up.
vi.mock("@/server/ai/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/tokens")>();
  return { ...actual, verifyAiToken: vi.fn(actual.verifyAiToken) };
});

const NOW = new Date("2027-03-01T10:00:00.000Z");
const RESOURCE = "https://mcp.example.test/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const SERVICE_KEY = "test-service-key-0123456789";
const IP = "198.51.100.20";
const MINUTE = 60_000;
const DAY = 86_400_000;
const SEARCH_MESSAGE = "Check the destination, dates and guests.";
const EXPIRED = "This search expired. Run search_hotels again.";
const none = async () => new Map();

function offer(propertyId: string, totalMinor: number, opts: Partial<Offer> & { rateId?: string } = {}): Offer {
  const price = {
    total: { minor: totalMinor, currency: "USD" },
    lines: [
      { kind: "room_rate" as const, amount: { minor: totalMinor - 1_550, currency: "USD" } },
      { kind: "taxes_and_fees" as const, amount: { minor: 1_000, currency: "USD" } },
      { kind: "taxes" as const, amount: { minor: 550, currency: "USD" } },
    ],
    dueAtProperty: [],
    dueAtPropertyTotal: null,
    nights: 2,
  };
  return {
    propertyId,
    roomId: "r1",
    roomName: "Double Room",
    rateId: opts.rateId ?? `rate-${totalMinor}`,
    refundable: true,
    bedGroups: [
      { id: "bg-secret-1", description: "1 King Bed", priceCheckToken: "pct-secret-token-1" },
      { id: "bg-secret-2", description: "2 Queen Beds", priceCheckToken: "pct-secret-token-2" },
    ],
    cancelPenalties: [
      { start: "2027-04-08T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: { minor: 5_000, currency: "USD" }, nights: null, percent: null },
      { start: "2027-04-07T00:00:00.000+02:00", end: "2027-04-08T00:00:00.000+02:00", amount: null, nights: 1, percent: null },
    ],
    nonrefundableDateRanges: [],
    amenities: ["Free WiFi", "Breakfast"],
    price,
    roomPrices: [price],
    ...opts,
  };
}

// Hotel 1: two rates (dear refundable, cheap non-refundable with a resort fee); hotel 2: one rate.
function respond(q: AvailabilityQuery): PropertyOffers[] {
  return q.propertyIds.map((id) => {
    if (id === "1") {
      return {
        propertyId: id,
        offers: [
          offer(id, 30_000),
          offer(id, 12_345, {
            refundable: false,
            price: {
              ...offer(id, 12_345).price,
              dueAtProperty: [{ kind: "resort_fee", amount: { minor: 4_000, currency: "USD" }, localAmount: { minor: 3_700, currency: "EUR" } }],
              dueAtPropertyTotal: { minor: 4_000, currency: "USD" },
            },
            roomPrices: [
              {
                ...offer(id, 12_345).price,
                dueAtProperty: [{ kind: "resort_fee", amount: { minor: 4_000, currency: "USD" }, localAmount: { minor: 3_700, currency: "EUR" } }],
                dueAtPropertyTotal: { minor: 4_000, currency: "USD" },
              },
            ],
          }),
        ],
      };
    }
    return { propertyId: id, offers: [offer(id, 20_000 + Number(id))] };
  });
}

function fakeAdapter(fn: (q: AvailabilityQuery) => PropertyOffers[] | Promise<PropertyOffers[]> = respond) {
  const searchAvailability = vi.fn<(q: AvailabilityQuery, c: SupplierContext) => Promise<PropertyOffers[]>>(async (q) => fn(q));
  return { adapter: { searchAvailability, priceCheck: vi.fn() } as unknown as SupplierAdapter, searchAvailability };
}

async function destination(id: string, name: string, nameFull: string, propertyCount: number) {
  await db.destination.create({ data: { id, name, nameFull, type: "city", countryCode: "FR", propertyCount, seenRunId: "r" } });
}

async function catalog() {
  await destination("paris", "Paris", "Paris, France", 3);
  await destination("paris-region", "Paris Region", "Paris Region, France", 1);
  await destination("sj-us", "San Jose", "San Jose, California, United States", 50);
  await destination("sj-cr", "San Jose", "San Jose, Costa Rica", 40);
  await destination("lyon", "Lyon", "Lyon, France", 1);
  for (const [id, stars] of [["1", "4.5"], ["2", "3.0"], ["3", null]] as const) {
    await db.property.create({
      data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", starRating: stars, rank: Number(id), expediaCollect: true, catalogSeenRunId: "r" },
    });
    await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: id } });
  }
}

let bankRef = 0;
async function agent(email: string) {
  bankRef += 1;
  const agency = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: `APL-${String(bankRef).padStart(4, "0")}` } });
  const user = await createUser({ email, name: "Agent Smith", role: "AGENT", agencyId: agency.id });
  const client = await db.aiClient.create({ data: { name: "Claude", redirectUris: [REDIRECT] } });
  const verifier = randomBytes(32).toString("base64url");
  const code = await issueAuthCode({
    userId: user.id,
    clientId: client.id,
    redirectUri: REDIRECT,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: RESOURCE,
  });
  const pair = await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE });
  if (!("accessToken" in pair)) throw new Error("no token");
  const connection = await db.aiConnection.findFirstOrThrow({ where: { userId: user.id } });
  return { userId: user.id, agencyId: agency.id, token: pair.accessToken, connectionId: connection.id };
}

type Agent = Awaited<ReturnType<typeof agent>>;
const authOf = (a: Agent): AiAuth => ({ serviceKey: SERVICE_KEY, bearer: a.token, ip: IP });

const searchBody = {
  destination_id: "paris",
  checkin: "2027-04-10",
  checkout: "2027-04-12",
  rooms: [{ adults: 2, child_ages: [] as number[] }],
  nationality: "IL",
};

let a: Agent;

beforeEach(async () => {
  await resetTestDb();
  vi.stubEnv("AI_SEARCH_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://app.example.test/");
  vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test");
  vi.stubEnv("AI_MCP_SERVICE_KEY", SERVICE_KEY);
  vi.mocked(verifyAiToken).mockClear();
  await catalog();
  a = await agent("agent@example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function search(body: unknown, deps = fakeAdapter(), who: Agent = a) {
  return aiSearch(authOf(who), body, { adapter: deps.adapter, content: none, now: NOW });
}

async function auditRows() {
  return db.auditLog.findMany({ where: { action: { startsWith: "ai.search_hotels" } } });
}

describe("caller checks, in order", () => {
  it("no or wrong service key → 401 before any token lookup", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const serviceKey of [null, "wrong-key", "", `${SERVICE_KEY}x`]) {
      const res = await aiSearch({ serviceKey, bearer: a.token, ip: IP }, searchBody, { now: NOW });
      expect(res).toEqual({ status: 401, json: { error: "unauthorized" } });
      const rates = await aiRates({ serviceKey, bearer: a.token, ip: IP }, { search_id: "x", hotel_id: "1" }, { now: NOW });
      expect(rates).toEqual({ status: 401, json: { error: "unauthorized" } });
    }
    expect(verifyAiToken).not.toHaveBeenCalled();
    expect(await db.auditLog.count({ where: { action: { startsWith: "ai.search" } } })).toBe(0);
  });

  it("no service key configured → nothing matches", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("AI_MCP_SERVICE_KEY", "");
    expect((await aiSearch({ serviceKey: "", bearer: a.token, ip: IP }, searchBody)).status).toBe(401);
    expect(verifyAiToken).not.toHaveBeenCalled();
  });

  it("valid key, missing or bad token → 401 invalid_token", async () => {
    for (const bearer of [null, "not-a-token", `${a.token}x`]) {
      expect(await aiSearch({ serviceKey: SERVICE_KEY, bearer, ip: IP }, searchBody)).toEqual({ status: 401, json: { error: "invalid_token" } });
      expect(await aiRates({ serviceKey: SERVICE_KEY, bearer, ip: IP }, { search_id: "x", hotel_id: "1" })).toEqual({
        status: 401,
        json: { error: "invalid_token" },
      });
    }
  });

  it("a revoked connection or a suspended agency → the very next call is 401", async () => {
    expect((await search(searchBody)).status).toBe(200);
    await db.agency.update({ where: { id: a.agencyId }, data: { status: "SUSPENDED" } });
    expect((await search(searchBody)).status).toBe(401);
  });

  it("10 wrong keys from one IP → the 11th call is refused with 429 even with the right key, before any token lookup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) {
      expect(await aiSearch({ serviceKey: `wrong-${i}`, bearer: a.token, ip: IP }, searchBody)).toEqual({ status: 401, json: { error: "unauthorized" } });
    }
    expect(await aiSearch(authOf(a), searchBody, { adapter: fakeAdapter().adapter, content: none, now: NOW })).toEqual({ status: 429, json: { error: "rate_limited" } });
    expect(await aiRates(authOf(a), { search_id: "x", hotel_id: "1" })).toEqual({ status: 429, json: { error: "rate_limited" } });
    expect(verifyAiToken).not.toHaveBeenCalled();
    // Only the failures were counted; the refused calls did not add to them.
    const fails = await db.rateLimitBucket.findMany({ where: { key: `ai-api:keyfail:ip:${IP}` } });
    expect(fails.map((b) => b.count)).toEqual([10]);
    // One fixed line per failure: neither the key nor the address.
    expect(warn.mock.calls).toEqual(Array.from({ length: 10 }, () => ["ai api: bad service key"]));
    // Another address is not affected.
    expect((await aiSearch({ ...authOf(a), ip: "198.51.100.21" }, searchBody, { adapter: fakeAdapter().adapter, content: none, now: NOW })).status).toBe(200);
  });

  it("good calls are not limited by the IP: 700 in a minute from one address still pass", async () => {
    await seedRateLimit(`ai-api:ip:${IP}`, 700, MINUTE);
    expect((await search(searchBody)).status).toBe(200);
    const rates = await aiRates(authOf(a), { search_id: "nope", hotel_id: "1" }, { now: NOW });
    expect(rates.status).toBe(404);
  });

  it("the loose per-IP ceiling: the 6,001st call in a minute → 429, before the key and the token are checked", async () => {
    await seedRateLimit(`ai-api:ip:${IP}`, 6_000, MINUTE);
    expect(await aiSearch(authOf(a), searchBody)).toEqual({ status: 429, json: { error: "rate_limited" } });
    expect(await aiRates({ serviceKey: null, bearer: null, ip: IP }, {})).toEqual({ status: 429, json: { error: "rate_limited" } });
    expect(verifyAiToken).not.toHaveBeenCalled();
  });

  it("21st tool call by one agent in a minute → 429 rate_limited (audited)", async () => {
    await seedRateLimit(`ai:user:${a.userId}`, 20, MINUTE);
    const { adapter, searchAvailability } = fakeAdapter();
    const res = await search(searchBody, { adapter, searchAvailability });
    expect(res.status).toBe(429);
    expect(res.json).toMatchObject({ error: "rate_limited" });
    expect((await aiRates(authOf(a), { search_id: "x", hotel_id: "1" })).status).toBe(429);
    expect(searchAvailability).not.toHaveBeenCalled();
    const rows = await db.auditLog.findMany({ where: { action: { in: ["ai.search_hotels", "ai.get_hotel_rates"] } } });
    expect(rows.map((r) => r.after)).toEqual([{ outcome: "rate_limited" }, { outcome: "rate_limited" }]);
  });

  it("501st tool call by one agent in a day → 429 rate_limited", async () => {
    await seedRateLimit(`ai:user:${a.userId}:day`, 500, DAY);
    expect((await search(searchBody)).status).toBe(429);
    // The minute bucket counted this call on its own row, not the day's.
    const minute = await db.rateLimitBucket.findMany({ where: { key: `ai:user:${a.userId}` } });
    expect(minute.map((b) => b.count)).toEqual([1]);
  });

  it("the agent's limit is per agent: another agent of another agency is not affected", async () => {
    const b = await agent("other@example.com");
    await seedRateLimit(`ai:user:${a.userId}`, 20, MINUTE);
    expect((await search(searchBody, fakeAdapter(), b)).status).toBe(200);
  });
});

describe("search_hotels", () => {
  it("answers with the agency's hotels, amounts to the cent, links and the fixed notes", async () => {
    const res = await search(searchBody);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown> & { hotels: Record<string, unknown>[]; search_id: string };
    expect(json).toMatchObject({
      destination: { destination_id: "paris", name: "Paris, France" },
      nights: 2,
      total_hotels: 3,
      notes: ["Prices are checked again before booking. Book in Apolles.", "Nationality does not change the price; the agency's country is used."],
    });
    const snapshot = await db.searchSnapshot.findUniqueOrThrow({ where: { id: json.search_id } });
    expect(snapshot).toMatchObject({ agencyId: a.agencyId, userId: a.userId, source: "AI" });
    expect(json.hotels[0]).toEqual({
      hotel_id: "1",
      name: "Hotel 1",
      city: "Paris",
      stars: 4.5,
      cheapest_total: { amount: "123.45", currency: "USD" },
      free_cancellation_available: true,
      fees_at_hotel: true,
      other_rates: 1,
      link: "https://app.example.test/search/open?dest=Hotel+1&type=hotel&in=2027-04-10&out=2027-04-12&rooms=2&nat=Israel&hotel=1&destId=paris",
    });
    expect(json.hotels[2]).toMatchObject({ hotel_id: "3", stars: null, cheapest_total: { amount: "200.03", currency: "USD" }, fees_at_hotel: false, other_rates: 0 });
  });

  it("sort, min_stars, free_cancellation_only and max_results reach the results list", async () => {
    const res = await search({ ...searchBody, sort: "price_asc", max_results: 2 });
    const json = res.json as { hotels: { hotel_id: string }[]; total_hotels: number };
    expect(json.hotels.map((h) => h.hotel_id)).toEqual(["1", "2"]);
    expect(json.total_hotels).toBe(3);

    const starred = (await search({ ...searchBody, min_stars: 4 })).json as { hotels: { hotel_id: string }[] };
    expect(starred.hotels.map((h) => h.hotel_id)).toEqual(["1"]);

    const free = (await search({ ...searchBody, free_cancellation_only: true, sort: "price_asc" })).json as {
      hotels: { hotel_id: string; cheapest_total: { amount: string } }[];
    };
    expect(free.hotels[0]).toMatchObject({ hotel_id: "2", cheapest_total: { amount: "200.02" } });
    expect(free.hotels.find((h) => h.hotel_id === "1")?.cheapest_total.amount).toBe("300.00");
  });

  it("the link carries the nationality as a country name; the search does not use it", async () => {
    const { adapter, searchAvailability } = fakeAdapter();
    const res = await search({ ...searchBody, nationality: "DE", rooms: [{ adults: 2, child_ages: [5, 9] }] }, { adapter, searchAvailability });
    const link = new URL((res.json as { hotels: { link: string }[] }).hotels[0]!.link);
    expect(link.searchParams.get("nat")).toBe("Germany");
    expect(link.searchParams.get("rooms")).toBe("2-5-9");
    expect(searchAvailability.mock.calls[0]![0].countryCode).toBe("IL");
  });

  it("destination text with one exact name match is searched", async () => {
    const res = await search({ ...searchBody, destination_id: undefined, destination: "paris" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ destination: { destination_id: "paris" } });
  });

  it("destination text with exactly one suggestion is searched", async () => {
    const res = await search({ ...searchBody, destination_id: undefined, destination: "Ly" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ destination: { destination_id: "lyon", name: "Lyon, France" }, total_hotels: 0 });
  });

  it("ambiguous destination text → candidates (at most 5) and no search", async () => {
    const { adapter, searchAvailability } = fakeAdapter();
    const res = await search({ ...searchBody, destination_id: undefined, destination: "San Jose" }, { adapter, searchAvailability });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      candidates: [
        { destination_id: "sj-us", name: "San Jose, California, United States", type: "city" },
        { destination_id: "sj-cr", name: "San Jose, Costa Rica", type: "city" },
      ],
      message: "Several places match. Call again with destination_id.",
    });
    expect(await db.searchSnapshot.count()).toBe(0);
    expect(searchAvailability).not.toHaveBeenCalled();

    for (let i = 0; i < 7; i++) await destination(`sa-${i}`, `Sa Place ${i}`, `Sa Place ${i}, Spain`, i);
    const many = (await search({ ...searchBody, destination_id: undefined, destination: "Sa" })).json as { candidates: unknown[] };
    expect(many.candidates).toHaveLength(5);
    expect(await db.searchSnapshot.count()).toBe(0);
    const rows = await auditRows();
    expect(rows.map((r) => (r.after as { outcome: string }).outcome)).toEqual(["ambiguous", "ambiguous"]);
    expect(rows[0]!.after).not.toHaveProperty("destination_id");
  });

  it("destination text that matches nothing → 400", async () => {
    const res = await search({ ...searchBody, destination_id: undefined, destination: "Atlantis" });
    expect(res).toEqual({ status: 400, json: { error: "invalid_request", message: "No destination matches that name." } });
  });

  it("an unknown destination_id → 400", async () => {
    const res = await search({ ...searchBody, destination_id: "nowhere" });
    expect(res.status).toBe(400);
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it.each([
    ["an unknown field", { ...searchBody, guest_name: "Dana" }],
    ["both destination and destination_id", { ...searchBody, destination: "Paris" }],
    ["neither destination nor destination_id", { ...searchBody, destination_id: undefined }],
    ["a lowercase nationality", { ...searchBody, nationality: "il" }],
    ["a nationality that is not a country", { ...searchBody, nationality: "XX" }],
    ["no nationality", { ...searchBody, nationality: undefined }],
    ["a room with 9 adults", { ...searchBody, rooms: [{ adults: 9, child_ages: [] }] }],
    ["a child of 18", { ...searchBody, rooms: [{ adults: 2, child_ages: [18] }] }],
    ["9 rooms", { ...searchBody, rooms: Array.from({ length: 9 }, () => ({ adults: 1, child_ages: [] })) }],
    ["an unknown room field", { ...searchBody, rooms: [{ adults: 2, child_ages: [], name: "x" }] }],
    ["max_results 21", { ...searchBody, max_results: 21 }],
    ["an unknown sort", { ...searchBody, sort: "price_desc" }],
    ["min_stars 6", { ...searchBody, min_stars: 6 }],
    ["not an object", "search paris"],
    ["null", null],
  ])("%s → 400 invalid_request", async (_name, body) => {
    const { adapter, searchAvailability } = fakeAdapter();
    const res = await search(body, { adapter, searchAvailability });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "invalid_request" });
    expect(typeof (res.json as { message: unknown }).message).toBe("string");
    expect(searchAvailability).not.toHaveBeenCalled();
    expect((await auditRows()).map((r) => r.after)).toEqual([{ outcome: "invalid" }]);
  });

  it("the 400 message says what to fix, without echoing the request", async () => {
    const message = async (body: unknown) => ((await search(body)).json as { message: string }).message;
    expect(await message({ ...searchBody, destination: "Paris" })).toBe("Give either destination or destination_id.");
    expect(await message({ ...searchBody, destination_id: undefined, destination: "P" })).toBe("destination must be 2 to 60 characters.");
    expect(await message({ ...searchBody, nationality: "il" })).toBe("nationality must be an ISO 3166 country code in capitals, e.g. IL.");
    expect(await message({ ...searchBody, guest_name: "Dana" })).toBe("The request has a field this tool does not take.");
    expect(await message(null)).toBe("The request body must be a JSON object.");
    expect(await message({ ...searchBody, rooms: [] })).toBe(SEARCH_MESSAGE);
  });

  it.each([
    ["check-in in the past", { checkin: "2027-02-27", checkout: "2027-03-02" }],
    ["29 nights", { checkin: "2027-04-01", checkout: "2027-04-30" }],
    ["check-out before check-in", { checkin: "2027-04-12", checkout: "2027-04-10" }],
    ["a date that does not exist", { checkin: "2027-02-30", checkout: "2027-03-02" }],
  ])("%s → 400 with the search service's message", async (_name, dates) => {
    const res = await search({ ...searchBody, ...dates });
    expect(res).toEqual({ status: 400, json: { error: "invalid_request", message: SEARCH_MESSAGE } });
    expect(await db.searchSnapshot.count()).toBe(0);
  });

  it("rooms out of range → 400 with the search service's message", async () => {
    const res = await search({ ...searchBody, rooms: [{ adults: 0, child_ages: [] }] });
    expect(res).toEqual({ status: 400, json: { error: "invalid_request", message: SEARCH_MESSAGE } });
    // Several rooms wait for the real supplier (plan 10): the search service's own message.
    const two = await search({ ...searchBody, rooms: [{ adults: 2, child_ages: [] }, { adults: 1, child_ages: [] }] });
    expect(two).toEqual({ status: 400, json: { error: "invalid_request", message: "Several rooms are not available yet." } });
  });

  it("the assistant's own agency search limit → 429; a supplier failure → 503", async () => {
    await seedRateLimit(`ai-search:agency:${a.agencyId}`, 10, MINUTE);
    const limited = await search(searchBody);
    expect(limited.status).toBe(429);
    expect(limited.json).toMatchObject({ error: "rate_limited" });
    await db.rateLimitBucket.deleteMany({ where: { key: `ai-search:agency:${a.agencyId}` } });

    const down = await search(
      searchBody,
      fakeAdapter(() => {
        throw new SupplierRateLimited("busy");
      }),
    );
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ error: "unavailable" });
    expect((await auditRows()).map((r) => (r.after as { outcome: string }).outcome)).toEqual(["rate_limited", "unavailable"]);
  });

  it("the supplier is called without the customer's IP, with the assistant's user agent", async () => {
    const { adapter, searchAvailability } = fakeAdapter();
    await search(searchBody, { adapter, searchAvailability });
    const context = searchAvailability.mock.calls[0]![1];
    expect(context).toEqual({ userAgent: "Apolles AI search" });
    expect("customerIp" in context).toBe(false);
  });

  it("without an injected adapter the search goes through the Expedia adapter's own availability call", async () => {
    const spy = vi.spyOn(ExpediaAdapter.prototype, "searchAvailability").mockImplementation(async (q) => respond(q));
    const res = await aiSearch(authOf(a), searchBody, { content: none, now: NOW });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toEqual({ userAgent: "Apolles AI search" });
  });

  it("every call writes one audit row naming the connection, without the token", async () => {
    await search(searchBody);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: a.userId,
      action: "ai.search_hotels",
      targetType: "AiConnection",
      targetId: a.connectionId,
      after: { destination_id: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: 1, results: 3, outcome: "ok" },
    });
    expect(JSON.stringify(rows[0])).not.toContain(a.token);
    expect(JSON.stringify(rows[0])).not.toContain(IP);
  });
});

describe("unexpected errors after the caller is known", () => {
  it("search: one audit row with outcome error, then the error goes up (route: 500, error name only)", async () => {
    const broken = fakeAdapter(() => {
      throw new TypeError("boom: secret detail");
    });
    await expect(search(searchBody, broken)).rejects.toBeInstanceOf(TypeError);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toMatchObject({ destination_id: "paris", outcome: "error" });
    expect(JSON.stringify(rows[0])).not.toContain("boom");
  });

  it("rates: one audit row with outcome error; the route answers 500 and logs only the error name", async () => {
    const id = ((await search(searchBody)).json as { search_id: string }).search_id;
    vi.stubEnv("APP_URL", "not a url"); // the link cannot be built
    await expect(aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: NOW })).rejects.toThrow();
    const rows = await db.auditLog.findMany({ where: { action: "ai.get_hotel_rates" } });
    expect(rows.map((r) => r.after)).toEqual([{ outcome: "error" }]);

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ratesRoute.POST(
      new Request("https://app.example.test/api/ai/v1/rates", {
        method: "POST",
        headers: { "x-forwarded-for": IP, "x-apolles-service-key": SERVICE_KEY, authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ search_id: id, hotel_id: "1" }),
      }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
    expect(logged.mock.calls).toEqual([["ai api failed: Error"]]);
    expect(await db.auditLog.count({ where: { action: "ai.get_hotel_rates" } })).toBe(2);
  });
});

describe("get_hotel_rates", () => {
  async function searchId(): Promise<string> {
    return ((await search(searchBody)).json as { search_id: string }).search_id;
  }

  it("lists the hotel's rates cheapest first, with the stay and the link", async () => {
    const id = await searchId();
    const res = await aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: NOW });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      search_id: id,
      hotel: { hotel_id: "1", name: "Hotel 1", city: "Paris", stars: 4.5 },
      stay: { checkin: "2027-04-10", checkout: "2027-04-12", nights: 2, rooms: [{ adults: 2, child_ages: [] }] },
      rates: [
        {
          room_name: "Double Room",
          bed_types: ["1 King Bed", "2 Queen Beds"],
          bed_type_note: "Bed type is a request and not guaranteed",
          refundable: false,
          free_cancellation_until: null,
          total: { amount: "123.45", currency: "USD" },
          taxes_and_fees: { amount: "15.50", currency: "USD" },
          fees_at_hotel: [{ kind: "resort_fee", amount: { amount: "40.00", currency: "USD" }, local_amount: { amount: "37.00", currency: "EUR" } }],
          amenities: ["Free WiFi", "Breakfast"],
        },
        {
          room_name: "Double Room",
          bed_types: ["1 King Bed", "2 Queen Beds"],
          bed_type_note: "Bed type is a request and not guaranteed",
          refundable: true,
          free_cancellation_until: "2027-04-07T00:00:00.000+02:00",
          total: { amount: "300.00", currency: "USD" },
          taxes_and_fees: { amount: "15.50", currency: "USD" },
          fees_at_hotel: [],
          amenities: ["Free WiFi", "Breakfast"],
        },
      ],
      link: "https://app.example.test/search/open?dest=Hotel+1&type=hotel&in=2027-04-10&out=2027-04-12&rooms=2&nat=Israel&hotel=1&destId=paris",
    });
    const rows = await db.auditLog.findMany({ where: { action: "ai.get_hotel_rates" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: a.userId, targetType: "AiConnection", targetId: a.connectionId, after: { results: 2, outcome: "ok" } });
    expect(JSON.stringify(rows[0])).not.toContain(a.token);
  });

  it("at most 30 rates and 10 amenities; a nationality given only changes the link", async () => {
    const many = (q: AvailabilityQuery) =>
      q.propertyIds.map((id) => ({
        propertyId: id,
        offers: Array.from({ length: 35 }, (_, i) => offer(id, 50_000 - i * 100, { amenities: Array.from({ length: 10 }, (_, j) => `Perk ${j}`) })),
      }));
    const id = ((await search(searchBody, fakeAdapter(many))).json as { search_id: string }).search_id;
    const res = await aiRates(authOf(a), { search_id: id, hotel_id: "2", nationality: "FR" }, { now: NOW });
    const json = res.json as { rates: { total: { amount: string }; amenities: string[] }[]; link: string };
    expect(json.rates).toHaveLength(30);
    expect(json.rates[0]!.total.amount).toBe("466.00");
    expect(json.rates[29]!.total.amount).toBe("495.00");
    expect(json.rates[0]!.amenities).toHaveLength(10);
    expect(new URL(json.link).searchParams.get("nat")).toBe("France");
  });

  it("free cancellation ends at the earliest penalty in time, whatever the offsets", async () => {
    // As text the -05:00 start sorts first, but in time it is the latest (01:00 UTC on the 8th);
    // the +05:00 one is the earliest (18:30 UTC on the 7th).
    const mixed = (q: AvailabilityQuery) =>
      q.propertyIds.map((id) => ({
        propertyId: id,
        offers: [
          offer(id, 30_000, {
            cancelPenalties: [
              { start: "2027-04-07T20:00:00.000-05:00", end: "2027-04-10T00:00:00.000-05:00", amount: null, nights: 1, percent: null },
              { start: "2027-04-08T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null },
              { start: "2027-04-07T23:30:00.000+05:00", end: "2027-04-10T00:00:00.000+05:00", amount: null, nights: 1, percent: null },
            ],
          }),
        ],
      }));
    const id = ((await search(searchBody, fakeAdapter(mixed))).json as { search_id: string }).search_id;
    const res = await aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: NOW });
    expect((res.json as { rates: { free_cancellation_until: string }[] }).rates[0]!.free_cancellation_until).toBe("2027-04-07T23:30:00.000+05:00");
  });

  it("an agency country that is not an ISO code → the link has no nat (never a made-up one)", async () => {
    const id = ((await search(searchBody)).json as { search_id: string }).search_id;
    await db.agency.update({ where: { id: a.agencyId }, data: { country: "ZZ" } });
    const res = await aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: NOW });
    expect(res.status).toBe(200);
    const link = new URL((res.json as { link: string }).link);
    expect(link.searchParams.has("nat")).toBe(false);
    expect(link.searchParams.get("hotel")).toBe("1");
  });

  it("an expired search → 404 with the message to search again", async () => {
    const id = await searchId();
    const later = new Date(NOW.getTime() + 31 * MINUTE);
    const res = await aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: later });
    expect(res).toEqual({ status: 404, json: { error: "not_found", message: EXPIRED } });
    const rows = await db.auditLog.findMany({ where: { action: "ai.get_hotel_rates" } });
    expect(rows.map((r) => r.after)).toEqual([{ outcome: "not_found" }]);
  });

  it("another agency's search_id, an unknown one or an unknown hotel → the same 404", async () => {
    const id = await searchId();
    const b = await agent("other@example.com");
    expect(await aiRates(authOf(b), { search_id: id, hotel_id: "1" }, { now: NOW })).toEqual({ status: 404, json: { error: "not_found", message: EXPIRED } });
    expect(await aiRates(authOf(a), { search_id: "nope", hotel_id: "1" }, { now: NOW })).toEqual({ status: 404, json: { error: "not_found", message: EXPIRED } });
    expect(await aiRates(authOf(a), { search_id: id, hotel_id: "99" }, { now: NOW })).toEqual({ status: 404, json: { error: "not_found", message: EXPIRED } });
  });

  it.each([
    ["an unknown field", { search_id: "s", hotel_id: "1", rate_id: "x" }],
    ["no hotel_id", { search_id: "s" }],
    ["a bad nationality", { search_id: "s", hotel_id: "1", nationality: "Israel" }],
    ["a hotel_id with odd characters", { search_id: "s", hotel_id: "1; drop" }],
  ])("%s → 400", async (_name, body) => {
    const res = await aiRates(authOf(a), body, { now: NOW });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "invalid_request" });
  });
});

describe("answers carry no personal data", () => {
  it("guest names, client data, balance, price-check tokens and the supplier's name never appear", async () => {
    await db.client.create({
      data: { agencyId: a.agencyId, firstName: "Yael", lastName: "Mizrahi", email: "yael.mizrahi@example.com", phone: "+972 50 765 4321", phoneDigits: "972507654321", nationality: "IL" },
    });
    await db.ledgerEntry.create({
      data: { agencyId: a.agencyId, type: "TOPUP_BANK", amountCents: 987_654, reason: "Bank transfer", idempotencyKey: "topup-1" },
    });
    await db.booking.create({
      data: {
        reference: "APL-PRIV0001", agencyId: a.agencyId, userId: a.userId, status: "CONFIRMED", propertyId: "1", hotelName: "Hotel 1", hotelCity: "Paris", roomId: "r1",
        roomName: "Double Room", rateId: "rate-30000", bedGroupId: "bg-secret-1", bedDescription: "1 King Bed", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [],
        leadGivenName: "Dana", leadFamilyName: "Levinson", leadEmail: "dana.levinson@example.com", leadPhone: "+972 52 111 2233",
        guests: [{ givenName: "Dana", familyName: "Levinson" }, { givenName: "Avishai", familyName: "Levinson" }],
        refundable: true, totalMinor: 30_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "pct-booking-token",
      },
    });
    const searched = await search(searchBody);
    const id = (searched.json as { search_id: string }).search_id;
    const rates = await aiRates(authOf(a), { search_id: id, hotel_id: "1" }, { now: NOW });
    expect(rates.status).toBe(200);
    for (const res of [searched, rates]) {
      const text = JSON.stringify(res.json);
      for (const secret of [
        "Dana", "Levinson", "Avishai", "Yael", "Mizrahi", "yael.mizrahi@example.com", "dana.levinson@example.com", "765 4321", "972507654321", "111 2233",
        "9876.54", "9,876.54", "987654", "APL-PRIV0001", "priceCheckToken", "pct-", "bg-secret", "rate-30000", "rate-12345", "Agent Smith", "agent@example.com", a.token, a.connectionId,
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/expedia/i);
    }
  });
});

describe("routes /api/ai/v1/search and /api/ai/v1/rates", () => {
  function post(path: string, body: string, headers: Record<string, string> = {}): Request {
    return new Request(`https://app.example.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": IP, "x-apolles-service-key": SERVICE_KEY, ...headers },
      body,
    });
  }

  it("off → 404 for every method, OPTIONS included", async () => {
    vi.stubEnv("AI_SEARCH_ENABLED", "false");
    for (const route of [searchRoute, ratesRoute]) {
      for (const method of ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
        const handler = route[method] as (r: Request) => Promise<Response>;
        const res = await handler(post("/api/ai/v1/search", "{}"));
        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(verifyAiToken).not.toHaveBeenCalled();
  });

  it("on → POST only; other methods 405", async () => {
    for (const route of [searchRoute, ratesRoute]) {
      const res = await route.GET();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("reads the service key and a Bearer token (any case) and answers no-store JSON", async () => {
    const res = await ratesRoute.POST(post("/api/ai/v1/rates", JSON.stringify({ search_id: "nope", hotel_id: "1" }), { authorization: `bearer ${a.token}` }));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found", message: EXPIRED });
  });

  it("no service key header → 401; a token in another scheme → 401 invalid_token", async () => {
    const noKey = await searchRoute.POST(post("/api/ai/v1/search", "{}", { "x-apolles-service-key": "", authorization: `Bearer ${a.token}` }));
    expect(noKey.status).toBe(401);
    expect(await noKey.json()).toEqual({ error: "unauthorized" });
    const basic = await searchRoute.POST(post("/api/ai/v1/search", "{}", { authorization: `Basic ${a.token}` }));
    expect(basic.status).toBe(401);
    expect(await basic.json()).toEqual({ error: "invalid_token" });
    expect(verifyAiToken).not.toHaveBeenCalledWith(a.token, expect.anything());
  });

  it("a body over 16 KB or not JSON → 400 invalid_request", async () => {
    const auth = { authorization: `Bearer ${a.token}` };
    const big = await ratesRoute.POST(post("/api/ai/v1/rates", JSON.stringify({ search_id: "x", hotel_id: "1", pad: "x".repeat(17_000) }), auth));
    expect(big.status).toBe(400);
    const notJson = await ratesRoute.POST(post("/api/ai/v1/rates", "{not json", auth));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "invalid_request" });
  });

  it("a session cookie without a token is not accepted", async () => {
    const res = await searchRoute.POST(post("/api/ai/v1/search", JSON.stringify(searchBody), { cookie: `apl_session=${a.token}` }));
    expect(res.status).toBe(401);
  });
});

// The MCP server (src/mcp, a separate process) reads these answers with its own schemas; it
// cannot import this code. Fed the real answers, it must pass them on whole (nothing dropped)
// and as successes.
describe("the MCP server reads these answers unchanged", () => {
  const through = async (name: string, args: Record<string, unknown>, res: { status: number; json: unknown }) =>
    callTool(name, args, async () => ({ kind: "answer", status: res.status, json: res.json }));

  it("hotels, candidates and rates", async () => {
    const found = await search(searchBody);
    const hotels = await through("search_hotels", searchBody, found);
    expect(hotels.isError).toBe(false);
    expect(hotels.structuredContent).toEqual(found.json);

    const ambiguous = await search({ ...searchBody, destination_id: undefined, destination: "San Jose" });
    const candidates = await through("search_hotels", { ...searchBody, destination_id: undefined, destination: "San Jose" }, ambiguous);
    expect(candidates.isError).toBe(false);
    expect(candidates.structuredContent).toEqual(ambiguous.json);

    const args = { search_id: (found.json as { search_id: string }).search_id, hotel_id: "1" };
    const listed = await aiRates(authOf(a), args, { now: NOW });
    const rates = await through("get_hotel_rates", args, listed);
    expect(rates.isError).toBe(false);
    expect(rates.structuredContent).toEqual(listed.json);
  });

  it("the API's 400 and 404 messages reach the assistant", async () => {
    const bad = await search({ ...searchBody, nationality: "XX" });
    expect(bad.status).toBe(400);
    const badResult = await through("search_hotels", searchBody, bad);
    expect(badResult).toMatchObject({ isError: true, content: [{ text: (bad.json as { message: string }).message }] });
    const gone = await aiRates(authOf(a), { search_id: "nope", hotel_id: "1" }, { now: NOW });
    expect(await through("get_hotel_rates", { search_id: "nope", hotel_id: "1" }, gone)).toMatchObject({ isError: true, content: [{ text: EXPIRED }] });
  });
});

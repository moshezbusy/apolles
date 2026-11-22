import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import type { AvailabilityQuery, Offer, SupplierAdapter } from "@/server/supplier/types";
import { assistantRates, assistantSearch } from "./search-api";
import { ASSISTANT_CLIENTS } from "./clients";
import { ACCESS_TOKEN_TTL_MS } from "./oauth";
import { generateRawToken, hashToken } from "@/server/auth/token";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const ISSUER = "http://localhost:3000";
const MCP = "http://localhost:3100/mcp";

function offer(propertyId: string, totalMinor: number, refundable = true): Offer {
  const price = {
    total: { minor: totalMinor, currency: "USD" },
    lines: [
      { kind: "room_rate" as const, amount: { minor: totalMinor - 2_000, currency: "USD" } },
      { kind: "taxes_and_fees" as const, amount: { minor: 2_000, currency: "USD" } },
    ],
    dueAtProperty: [{ kind: "resort_fee" as const, amount: { minor: 3_000, currency: "USD" }, localAmount: { minor: 2_800, currency: "EUR" } }],
    dueAtPropertyTotal: { minor: 3_000, currency: "USD" },
    nights: 2,
  };
  return {
    propertyId,
    roomId: "r1",
    roomName: "Deluxe Double",
    rateId: `rate-${propertyId}`,
    refundable,
    bedGroups: [{ id: "b1", description: "1 Queen Bed", priceCheckToken: "SECRET-PRICE-CHECK-TOKEN" }],
    cancelPenalties: refundable ? [{ start: "2027-04-08T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }] : [],
    nonrefundableDateRanges: [],
    amenities: ["Breakfast for 2"],
    price,
    roomPrices: [price],
  };
}

function fakeAdapter() {
  const searchAvailability = vi.fn(async (q: AvailabilityQuery) => q.propertyIds.map((id) => ({ propertyId: id, offers: [offer(id, 20_000 + Number(id)), offer(id, 30_000, false)] })));
  return { adapter: { searchAvailability, priceCheck: vi.fn() } as unknown as SupplierAdapter, searchAvailability };
}

const content = vi.fn(async () => new Map());

async function seedHotels() {
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 3, seenRunId: "r" } });
  await db.destination.create({ data: { id: "parma", name: "Parma", nameFull: "Parma, Italy", type: "city", countryCode: "IT", propertyCount: 1, seenRunId: "r" } });
  for (const id of ["1", "2", "3"]) {
    await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Paris", countryCode: "FR", starRating: "4.0", rank: Number(id), expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: id } });
  }
}

const searchInput = { destination: "Paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] };

let caller: { connectionId: string; userId: string; agencyId: string };
let otherCaller: { connectionId: string; userId: string; agencyId: string };

describe("assistant search API (service)", () => {
  beforeEach(async () => {
    await resetTestDb();
    content.mockClear();
    const a = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } });
    const b = await db.agency.create({ data: { name: "Other", country: "US", bankReference: "APL-0002" } });
    const ua = await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: a.id });
    const ub = await createUser({ email: "b@other.example", name: "Ben", role: "AGENT", agencyId: b.id });
    caller = { connectionId: "c1", userId: ua.id, agencyId: a.id };
    otherCaller = { connectionId: "c2", userId: ub.id, agencyId: b.id };
    await seedHotels();
  });

  it("searches the first matching destination with the agency's country and returns hotels with links into Apolles", async () => {
    const { adapter, searchAvailability } = fakeAdapter();
    const result = await assistantSearch(caller, searchInput, { adapter, content, now: NOW, issuer: ISSUER });
    if (!result.ok) throw new Error(result.error);
    expect(searchAvailability.mock.calls[0]![0]).toMatchObject({ countryCode: "IL", checkin: "2027-04-10", checkout: "2027-04-12" });
    expect(result.data.destination).toBe("Paris, France");
    expect(result.data.otherMatchingDestinations).toEqual([]); // "Paris" does not match Parma
    expect(result.data.hotels).toHaveLength(3);
    const first = result.data.hotels[0]!;
    expect(first).toMatchObject({
      hotelId: "1",
      name: "Hotel 1",
      stars: "4.0",
      area: "Paris",
      cheapestRoom: {
        roomName: "Deluxe Double",
        included: ["Breakfast for 2"],
        total: "USD 200.01",
        nights: 2,
        taxesAndFees: "USD 20.00",
        payAtHotel: [{ what: "resort fee", amount: "USD 30.00", localAmount: "EUR 28.00" }],
        freeCancellationUntil: "2027-04-07T22:00:00.000Z",
      },
    });
    expect(first.link).toBe(`${ISSUER}/search/${result.data.searchId}/hotels/1`);
  });

  it("never returns price-check tokens, rate ids or the supplier's name", async () => {
    const { adapter } = fakeAdapter();
    const result = await assistantSearch(caller, searchInput, { adapter, content, now: NOW, issuer: ISSUER });
    const text = JSON.stringify(result);
    expect(text).not.toContain("SECRET-PRICE-CHECK-TOKEN");
    expect(text).not.toContain("rate-1");
    expect(text.toLowerCase()).not.toContain("expedia");
  });

  it("refuses unknown fields, bad dates and a destination that matches nothing", async () => {
    const { adapter, searchAvailability } = fakeAdapter();
    expect(await assistantSearch(caller, { ...searchInput, agencyId: "x" }, { adapter, content, now: NOW, issuer: ISSUER })).toMatchObject({ ok: false, status: 400 });
    expect(await assistantSearch(caller, { ...searchInput, checkout: "2027-04-09" }, { adapter, content, now: NOW, issuer: ISSUER })).toMatchObject({ ok: false, status: 400 });
    expect(await assistantSearch(caller, { ...searchInput, destination: "Atlantis" }, { adapter, content, now: NOW, issuer: ISSUER })).toMatchObject({ ok: false, status: 400 });
    expect(searchAvailability).not.toHaveBeenCalled();
  });

  it("rates of one hotel: every rate, same safe fields; another agency's search is not found (no IDOR)", async () => {
    const { adapter } = fakeAdapter();
    const result = await assistantSearch(caller, searchInput, { adapter, content, now: NOW, issuer: ISSUER });
    if (!result.ok) throw new Error(result.error);
    const rates = await assistantRates(caller, { searchId: result.data.searchId, hotelId: "2" }, { content, now: NOW, issuer: ISSUER });
    if (!rates.ok) throw new Error(rates.error);
    expect(rates.data.hotel).toMatchObject({ name: "Hotel 2", area: "Paris" });
    expect(rates.data.rooms).toHaveLength(2);
    expect(rates.data.rooms[1]).toMatchObject({ refundable: false, freeCancellationUntil: null, total: "USD 300.00" });
    expect(JSON.stringify(rates)).not.toContain("SECRET-PRICE-CHECK-TOKEN");

    const stolen = await assistantRates(otherCaller, { searchId: result.data.searchId, hotelId: "2" }, { content, now: NOW, issuer: ISSUER });
    expect(stolen).toMatchObject({ ok: false, status: 404 });
    const expired = await assistantRates(caller, { searchId: result.data.searchId, hotelId: "2" }, { content, now: new Date(NOW.getTime() + 31 * 60_000), issuer: ISSUER });
    expect(expired).toMatchObject({ ok: false, status: 404 });
    expect(await assistantRates(caller, { searchId: result.data.searchId, hotelId: "2", extra: 1 }, { content, now: NOW, issuer: ISSUER })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("assistant search API (routes)", () => {
  let token: string;
  let agentId: string;

  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("APP_URL", ISSUER);
    vi.stubEnv("ASSISTANT_MCP_URL", MCP);
    vi.stubEnv("SUPPLIER_MODE", "fake");
    const a = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } });
    agentId = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: a.id })).id;
    token = generateRawToken();
    const now = new Date();
    await db.assistantConnection.create({
      data: {
        agencyId: a.id,
        userId: agentId,
        clientId: ASSISTANT_CLIENTS[0]!.clientId,
        clientName: "Claude",
        tokenHash: hashToken(token),
        resource: MCP,
        authCodeId: "code-1",
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  function call(path: "search" | "rates", body: unknown, headers: Record<string, string>) {
    return new Request(`${ISSUER}/api/assistant/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  }

  it("404 while the connector is off", async () => {
    vi.stubEnv("ASSISTANT_MCP_URL", "");
    const { POST } = await import("@/app/api/assistant/search/route");
    expect((await POST(call("search", searchInput, { authorization: `Bearer ${token}` }))).status).toBe(404);
  });

  it("refuses a session cookie, a missing, wrong or revoked token with 401 and WWW-Authenticate", async () => {
    const { POST } = await import("@/app/api/assistant/search/route");
    const session = await createSession(agentId, { verified: true });
    for (const headers of [{ cookie: `${SESSION_COOKIE}=${session}` }, {}, { authorization: "Bearer nope-nope-nope-nope-nope" }, { authorization: `Basic ${token}` }]) {
      const res = await POST(call("search", searchInput, headers));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    }
    await db.assistantConnection.updateMany({ data: { revokedAt: new Date() } });
    expect((await POST(call("search", searchInput, { authorization: `Bearer ${token}` }))).status).toBe(401);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("a valid token: answers, writes one audit row with no token, updates lastUsedAt", async () => {
    const { POST } = await import("@/app/api/assistant/search/route");
    const res = await POST(call("search", { ...searchInput, destination: "zz-no-such-place" }, { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(400);
    const rows = await db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: agentId, action: "assistant.search", targetType: "AssistantConnection" });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await db.assistantConnection.findFirst())!.lastUsedAt).not.toBeNull();
  });

  it("is rate limited per agency", async () => {
    const { POST } = await import("@/app/api/assistant/rates/route");
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) last = await POST(call("rates", { searchId: "nope", hotelId: "1" }, { authorization: `Bearer ${token}` }));
    expect(last!.status).toBe(429);
  });
});

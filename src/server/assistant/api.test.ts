import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import type { AvailabilityQuery, SupplierAdapter } from "@/server/supplier/types";
import { createConnection } from "./connections";
import { handleAssistantTool, handleTokenCheck } from "./api";

// The assistant search API (src/app/api/assistant/*): the only place that reads assistant tokens.
// It takes the token from the Authorization header only, never a cookie, and the agency only from
// the token. Every call is rate limited and written to the audit log (without the token).

const RESOURCE = "https://mcp.apolles.test/mcp";
const saved = process.env.MCP_PUBLIC_URL;
const NOW = new Date("2027-03-01T10:00:00.000Z");

const adapter = {
  searchAvailability: vi.fn(async (q: AvailabilityQuery) =>
    q.propertyIds.map((id) => ({
      propertyId: id,
      offers: [
        {
          propertyId: id,
          roomId: "r1",
          roomName: "Double",
          rateId: "rt1",
          refundable: false,
          bedGroups: [{ id: "b1", description: "1 Queen Bed", priceCheckToken: "tok" }],
          cancelPenalties: [],
          nonrefundableDateRanges: [],
          amenities: [],
          price: { total: { minor: 20_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
          roomPrices: [{ total: { minor: 20_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }],
        },
      ],
    })),
  ),
  priceCheck: vi.fn(),
} as unknown as SupplierAdapter;
const deps = { adapter, now: NOW, content: async () => new Map() };

async function connected(email = "agent@example.com") {
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: `APL-${email}` } });
  const user = await createUser({ email, name: "Agent", role: "AGENT", agencyId: agency.id });
  const client = await db.assistantClient.upsert({ where: { id: "apc_test" }, create: { id: "apc_test", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] }, update: {} });
  const issued = await db.$transaction((tx) => createConnection(tx, { userId: user.id, agencyId: agency.id, clientId: client.id, clientName: "Claude", resource: RESOURCE }, new Date()));
  return { userId: user.id, agencyId: agency.id, token: issued.accessToken, connectionId: issued.connectionId };
}

function call(tool: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/assistant/${tool}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const stay = { destination: "Paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] };

describe("assistant search API", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
    process.env.MCP_PUBLIC_URL = RESOURCE;
    await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
    await db.property.create({ data: { id: "1", name: "Hotel 1", city: "Paris", countryCode: "FR", starRating: "4.0", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "1" } });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = saved;
  });

  it("runs search_hotels for the token's agency and audits the call without the token", async () => {
    const who = await connected();
    const response = await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${who.token}` }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { ok: boolean; data: { searchId: string; hotels: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.hotels).toHaveLength(1);
    const snapshot = await db.searchSnapshot.findUniqueOrThrow({ where: { id: body.data.searchId } });
    expect(snapshot).toMatchObject({ agencyId: who.agencyId, userId: who.userId });

    const rows = await db.auditLog.findMany({ where: { action: "assistant.search_hotels" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: who.userId, targetType: "AssistantConnection", targetId: who.connectionId });
    expect(JSON.stringify(rows[0])).not.toContain(who.token);

    const rates = await handleAssistantTool("get_hotel_rates", call("get_hotel_rates", { searchId: body.data.searchId, hotelId: "1" }, { authorization: `Bearer ${who.token}` }), deps);
    expect(rates.status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "assistant.get_hotel_rates" } })).toBe(1);
  });

  it("refuses without a token, with a session cookie only, with a bad or revoked token (401 + where to sign in)", async () => {
    const who = await connected();
    const cookie = `${SESSION_COOKIE}=${await createSession(who.userId, { verified: true })}`;
    for (const headers of [{}, { cookie }, { authorization: "Bearer aplat_wrong" }, { authorization: who.token }, { authorization: `Basic ${who.token}` }]) {
      const response = await handleAssistantTool("search_hotels", call("search_hotels", stay, headers), deps);
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('Bearer error="invalid_token"');
    }
    await db.assistantConnection.updateMany({ data: { revokedAt: new Date() } });
    expect((await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${who.token}` }), deps)).status).toBe(401);
    expect(adapter.searchAvailability).not.toHaveBeenCalled(); // nothing behind the check ran
    expect(await db.auditLog.count({ where: { action: { startsWith: "assistant.search" } } })).toBe(0);
  });

  it("a session token is not an assistant token, and the session cookie never stands in for one", async () => {
    const who = await connected();
    const sessionToken = await createSession(who.userId, { verified: true });
    expect((await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${sessionToken}` }), deps)).status).toBe(401);
  });

  it("only the two tools exist", async () => {
    const who = await connected();
    for (const tool of ["book", "cancel_booking", "get_balance", "list_bookings", "voucher", "__proto__", "constructor"]) {
      const response = await handleAssistantTool(tool, call(tool, {}, { authorization: `Bearer ${who.token}` }), deps);
      expect(response.status, tool).toBe(404);
    }
  });

  it("refuses a body that is not JSON or too large", async () => {
    const who = await connected();
    expect((await handleAssistantTool("search_hotels", call("search_hotels", "not json", { authorization: `Bearer ${who.token}` }), deps)).status).toBe(400);
    expect((await handleAssistantTool("search_hotels", call("search_hotels", JSON.stringify({ ...stay, pad: "x".repeat(40_000) }), { authorization: `Bearer ${who.token}` }), deps)).status).toBe(413);
  });

  it("is rate limited per connection, and per agency as a backstop", async () => {
    const who = await connected();
    await seedRateLimit(`assistant:connection:${who.connectionId}`, 60, 60_000);
    const limited = await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${who.token}` }), deps);
    expect(limited.status).toBe(429);
    expect(await db.auditLog.count({ where: { action: "assistant.search_hotels" } })).toBe(1); // refused calls are logged too

    const other = await connected("second@example.com");
    await seedRateLimit(`assistant:agency:${other.agencyId}`, 300, 60_000);
    expect((await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${other.token}` }), deps)).status).toBe(429);
  });

  it("the token check used by the connector answers 204 for a good token and 401 otherwise", async () => {
    const who = await connected();
    expect((await handleTokenCheck(call("check", "", { authorization: `Bearer ${who.token}` }))).status).toBe(204);
    expect((await handleTokenCheck(call("check", "", {}))).status).toBe(401);
  });

  it("is off (404) while the connector is not set up", async () => {
    const who = await connected();
    delete process.env.MCP_PUBLIC_URL;
    expect((await handleAssistantTool("search_hotels", call("search_hotels", stay, { authorization: `Bearer ${who.token}` }), deps)).status).toBe(404);
  });
});

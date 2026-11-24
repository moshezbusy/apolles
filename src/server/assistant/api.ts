import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { readLimitedText } from "@/server/http-body";
import { hitRateLimit } from "@/server/rate-limit";
import { assistantConfig } from "./config";
import { verifyAccessToken } from "./connections";
import { assistantHotelRates, assistantSearchHotels, type ToolResult } from "./search";

// The assistant search API (src/app/api/assistant/*), called only by the MCP connector process.
//
// - The token comes from the Authorization header only ("Bearer aplat_..."). Cookies are never
//   read here, so a signed-in browser cannot be used to call it, and the agency comes only from
//   the token (never from the request).
// - Exactly two tools. Anything else is 404 before any token is even checked.
// - Rate limited per connection and per agency (on top of the search service's own per-user and
//   per-agency limits), and every call that passed the token check is audited: tool, outcome and
//   the search terms (destination, dates, number of rooms), never the token.

export const ASSISTANT_TOOLS = ["search_hotels", "get_hotel_rates"] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

const MAX_BODY_BYTES = 16 * 1024;
const PER_CONNECTION = { limit: 60, windowMs: 60_000 };
const PER_AGENCY = { limit: 300, windowMs: 60_000 };

type Deps = Parameters<typeof assistantSearchHotels>[2];

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function unauthorized(): Response {
  // The MCP connector turns this into the MCP 401 challenge (with its resource metadata).
  return json(401, { ok: false, code: "unauthorized", message: "Sign in again." }, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  const match = value ? /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(value) : null;
  return match?.[1] ?? null;
}

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  const text = await readLimitedText(request, MAX_BODY_BYTES);
  if (text === null) return { ok: false, status: 413 };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

function isTool(name: string): name is AssistantTool {
  return (ASSISTANT_TOOLS as readonly string[]).includes(name);
}

// What the audit row keeps of the arguments: the search terms, nothing free-form.
function auditedArgs(tool: AssistantTool, args: unknown): Prisma.InputJsonValue {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const short = (v: unknown) => (typeof v === "string" ? v.slice(0, 64) : null);
  if (tool === "get_hotel_rates") return { searchId: short(a.searchId), hotelId: short(a.hotelId) };
  return { destination: short(a.destination), destinationId: short(a.destinationId), checkin: short(a.checkin), checkout: short(a.checkout), rooms: Array.isArray(a.rooms) ? a.rooms.length : null };
}

export async function handleAssistantTool(tool: string, request: Request, deps: Deps = {}): Promise<Response> {
  if (!assistantConfig()) return json(404, { ok: false, code: "not_found" });
  if (!isTool(tool)) return json(404, { ok: false, code: "unknown_tool", message: "Only search_hotels and get_hotel_rates exist." });
  const who = await verifyAccessToken(bearer(request));
  if (!who) return unauthorized();

  const body = await readBody(request);
  if (!body.ok) return json(body.status, { ok: false, code: "invalid_input", message: "Send the arguments as a small JSON object." });

  const record = (outcome: string) =>
    audit(who.userId, `assistant.${tool}`, "AssistantConnection", who.connectionId, undefined, { outcome, ...(auditedArgs(tool, body.value) as Record<string, Prisma.InputJsonValue>) });

  const connection = await hitRateLimit(`assistant:connection:${who.connectionId}`, PER_CONNECTION.limit, PER_CONNECTION.windowMs);
  const agency = connection.allowed ? await hitRateLimit(`assistant:agency:${who.agencyId}`, PER_AGENCY.limit, PER_AGENCY.windowMs) : null;
  if (!connection.allowed || !agency?.allowed) {
    // Only the first refusal of the minute is logged: an assistant stuck in a loop does not fill
    // the audit log.
    const firstRefusal = !connection.allowed ? connection.count === PER_CONNECTION.limit + 1 : agency?.count === PER_AGENCY.limit + 1;
    if (firstRefusal) await record("rate_limited");
    return json(429, { ok: false, code: "rate_limited", message: "Too many searches. Wait a minute and try again." });
  }

  const owner = { agencyId: who.agencyId, userId: who.userId };
  const result: ToolResult<unknown> = tool === "search_hotels" ? await assistantSearchHotels(owner, body.value, deps) : await assistantHotelRates(owner, body.value, deps);
  await record(result.ok ? "ok" : result.code);
  return json(result.ok ? 200 : result.code === "rate_limited" ? 429 : 200, result);
}

// For the MCP connector, before it answers initialize / tools/list: is this token good? 204 or 401.
export async function handleTokenCheck(request: Request): Promise<Response> {
  if (!assistantConfig()) return json(404, { ok: false, code: "not_found" });
  return (await verifyAccessToken(bearer(request))) ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : unauthorized();
}

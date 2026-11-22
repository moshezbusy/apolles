import { audit } from "@/server/audit";
import { hitRateLimit } from "@/server/rate-limit";
import { assistantConfig } from "./config";
import { verifyAccessToken } from "./connections";
import { jsonResponse, notFound, readCapped } from "./http";
import { assistantRates, assistantSearch } from "./search-api";

// The assistant search API (POST /api/assistant/search and /rates), called by the MCP server
// with the agent's assistant token. Only an "Authorization: Bearer" assistant token is read:
// never a session cookie. The agencyId comes from the token only. 60 calls a minute per agency
// (searches also count in the search service's own limit), and one audit row per call, without
// the token.

const MAX_BODY = 8_000;
const LIMIT = { limit: 60, windowMs: 60_000 };
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,128})$/;

function unauthorized(): Response {
  return jsonResponse({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
}

export async function handleAssistantCall(request: Request, tool: "search" | "rates"): Promise<Response> {
  const config = assistantConfig();
  if (!config) return notFound();
  const match = BEARER.exec(request.headers.get("authorization") ?? "");
  if (!match) return unauthorized();
  const caller = await verifyAccessToken(match[1]!, config);
  if (!caller) return unauthorized();

  const { allowed } = await hitRateLimit(`assistant:agency:${caller.agencyId}`, LIMIT.limit, LIMIT.windowMs);
  if (!allowed) return jsonResponse({ error: "Too many requests. Wait a minute and try again." }, 429, { "Retry-After": "60" });

  let body: unknown = null;
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const text = type.startsWith("application/json") ? await readCapped(request, MAX_BODY) : null;
  if (text !== null) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  const deps = { issuer: config.issuer };
  const result = body === null ? ({ ok: false, status: 400, error: "Send a JSON body." } as const) : tool === "search" ? await assistantSearch(caller, body, deps) : await assistantRates(caller, body, deps);
  await audit(caller.userId, `assistant.${tool}`, "AssistantConnection", caller.connectionId, undefined, { status: result.ok ? 200 : result.status });
  return result.ok ? jsonResponse(result.data) : jsonResponse({ error: result.error }, result.status);
}

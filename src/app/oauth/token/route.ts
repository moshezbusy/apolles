import { assistantConfig } from "@/server/assistant/config";
import { ipAllowed, jsonResponse, notFound, readCapped } from "@/server/assistant/http";
import { exchangeCode } from "@/server/assistant/oauth";

// OAuth token endpoint of the AI assistant connector: authorization code + PKCE only, form
// encoded (RFC 6749 3.2). The token is never logged.

const MAX_BODY = 4_000;
const LIMIT = { limit: 30, windowMs: 60_000 }; // per IP

export async function POST(request: Request): Promise<Response> {
  const config = assistantConfig();
  if (!config) return notFound();
  if (!(await ipAllowed(request, "assistant-token", LIMIT.limit, LIMIT.windowMs))) return jsonResponse({ error: "slow_down" }, 429);
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return jsonResponse({ error: "invalid_request" }, 400);
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return jsonResponse({ error: "invalid_request" }, 400);
  const params = new URLSearchParams(text);
  const fields: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.length !== 1) return jsonResponse({ error: "invalid_request" }, 400); // repeated parameter
    fields[key] = values[0]!;
  }
  const result = await exchangeCode(fields, config);
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);
  return jsonResponse({ access_token: result.accessToken, token_type: "Bearer", expires_in: result.expiresIn, scope: result.scope });
}

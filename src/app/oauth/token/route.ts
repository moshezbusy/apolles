import { getClientIp } from "@/server/client-ip";
import { exchangeToken } from "@/server/assistant/oauth";

// OAuth token endpoint for AI assistants: form-encoded, public clients with PKCE
// (src/server/assistant/oauth.ts). Answers are never cached.
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const text = await request.text();
  if (!type.startsWith("application/x-www-form-urlencoded") || text.length > MAX_BODY_BYTES) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  }
  const result = await exchangeToken(new URLSearchParams(text), getClientIp(request.headers));
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

import { getClientIp } from "@/server/client-ip";
import { readLimitedText } from "@/server/http-body";
import { exchangeToken } from "@/server/assistant/oauth";

// OAuth token endpoint for AI assistants: form-encoded, public clients with PKCE
// (src/server/assistant/oauth.ts). Answers are never cached.
const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function POST(request: Request): Promise<Response> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  const text = await readLimitedText(request, MAX_BODY_BYTES);
  if (text === null) return Response.json({ error: "invalid_request" }, { status: 413, headers: NO_STORE });
  const result = await exchangeToken(new URLSearchParams(text), getClientIp(request.headers));
  return Response.json(result.body, { status: result.status, headers: NO_STORE });
}

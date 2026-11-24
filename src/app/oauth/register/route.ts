import { getClientIp } from "@/server/client-ip";
import { registerClient } from "@/server/assistant/oauth";

// OAuth dynamic client registration (RFC 7591) for Claude and ChatGPT (src/server/assistant/oauth.ts).
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  let body: unknown = null;
  if (text.length <= MAX_BODY_BYTES) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  const result = await registerClient(body, getClientIp(request.headers));
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

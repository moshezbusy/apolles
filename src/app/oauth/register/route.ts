import { z } from "zod";
import { clientForRedirects } from "@/server/assistant/clients";
import { assistantConfig } from "@/server/assistant/config";
import { ipAllowed, jsonResponse, notFound, readCapped } from "@/server/assistant/http";

// Dynamic client registration (RFC 7591) for the AI assistant connector. Nothing is stored: a
// registration whose redirect URIs all belong to one known assistant (clients.ts) gets that
// assistant's fixed public client id; anything else is refused. The client's own name, logo and
// auth method are ignored.

const MAX_BODY = 8_000;
const LIMIT = { limit: 20, windowMs: 60 * 60_000 }; // per IP

const registration = z.object({ redirect_uris: z.array(z.string().max(2000)).min(1).max(5) }).passthrough();

export async function POST(request: Request): Promise<Response> {
  if (!assistantConfig()) return notFound();
  if (!(await ipAllowed(request, "assistant-register", LIMIT.limit, LIMIT.windowMs))) return jsonResponse({ error: "slow_down" }, 429);
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return jsonResponse({ error: "invalid_client_metadata" }, 400);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "invalid_client_metadata" }, 400);
  }
  const parsed = registration.safeParse(raw);
  if (!parsed.success) return jsonResponse({ error: "invalid_client_metadata" }, 400);
  const client = clientForRedirects(parsed.data.redirect_uris);
  if (!client) return jsonResponse({ error: "invalid_redirect_uri" }, 400);
  return jsonResponse(
    {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: [...client.redirectUris],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    201,
  );
}

import { aiSearchEnabled } from "@/server/ai/config";
import { endpointResponse, handleTokenRequest, readForm } from "@/server/ai/oauth";
import { getClientIp } from "@/server/client-ip";

// OAuth token endpoint: authorization_code (PKCE S256) and refresh_token grants for public
// clients (rules in src/server/ai/oauth.ts). Off → 404 for every method.

const NO_STORE = { "Cache-Control": "no-store" };

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (!aiSearchEnabled()) return notFound();
  const fields = await readForm(request);
  return endpointResponse(await handleTokenRequest(fields, getClientIp(request.headers)));
}

async function methodNotAllowed(): Promise<Response> {
  if (!aiSearchEnabled()) return notFound();
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
// Next.js would otherwise answer OPTIONS itself (204 + Allow), even while the feature is off.
export const OPTIONS = methodNotAllowed;

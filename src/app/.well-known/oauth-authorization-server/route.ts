import { aiSearchEnabled, appIssuer } from "@/server/ai/config";

// OAuth authorization server metadata (RFC 8414) for Claude and ChatGPT. The issuer is the
// app's own address (APP_URL); every endpoint lives under it. Off → 404 for every method.

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(): Promise<Response> {
  if (!aiSearchEnabled()) return notFound();
  const issuer = appIssuer();
  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      scopes_supported: ["search:read", "offline_access"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    },
    // Short cache: turning the switch off takes effect within minutes.
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

async function methodNotAllowed(): Promise<Response> {
  if (!aiSearchEnabled()) return notFound();
  return new Response(null, { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
// Next.js would otherwise answer OPTIONS itself (204 + Allow), even while the feature is off.
export const OPTIONS = methodNotAllowed;

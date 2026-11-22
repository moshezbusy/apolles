import { assistantConfig } from "@/server/assistant/config";
import { jsonResponse, notFound } from "@/server/assistant/http";
import { SCOPE } from "@/server/assistant/oauth";

// OAuth authorization server metadata (RFC 8414) for the search-only AI assistant connector.
// 404 while the connector is off (ASSISTANT_MCP_URL not set).
export async function GET(): Promise<Response> {
  const config = assistantConfig();
  if (!config) return notFound();
  const base = config.issuer;
  return jsonResponse(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
}

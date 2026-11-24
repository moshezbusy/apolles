import { authorizationServerMetadata } from "@/server/assistant/oauth";

// OAuth authorization server metadata (RFC 8414) for AI assistants (plan 2026-11-22). 404 while
// the connector is not set up (MCP_PUBLIC_URL unset).
export function GET(): Response {
  const metadata = authorizationServerMetadata();
  if (!metadata) return new Response("Not found", { status: 404 });
  return Response.json(metadata, { headers: { "Cache-Control": "public, max-age=300" } });
}

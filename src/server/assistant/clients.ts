// The AI assistants that may connect, each with its fixed OAuth redirect URIs. Dynamic client
// registration only ever hands out one of these (src/app/oauth/register): a registration with
// any other redirect URI is refused, so an authorization code can only travel to these hosts.
// The name shown to the agent comes from here, never from what the client sends.
//
// Claude: https://claude.ai/api/mcp/auth_callback, checked 2026-11-22 against
//   claude.com/docs/connectors/building/authentication (claude.ai web, Desktop and mobile).
// ChatGPT: https://chatgpt.com/connector_platform_oauth_redirect, checked 2026-11-22 against
//   developers.openai.com/apps-sdk/build/auth: ChatGPT uses this stable URI when the server
//   supports issuer identification (we advertise authorization_response_iss_parameter_supported
//   and always return iss). Otherwise it would use a per-connector URI, which is not listed.

export type AssistantClient = { clientId: string; name: string; redirectUris: readonly string[] };

export const ASSISTANT_CLIENTS: readonly AssistantClient[] = [
  { clientId: "apolles-claude", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] },
  { clientId: "apolles-chatgpt", name: "ChatGPT", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] },
];

export function clientById(clientId: unknown): AssistantClient | null {
  if (typeof clientId !== "string") return null;
  return ASSISTANT_CLIENTS.find((c) => c.clientId === clientId) ?? null;
}

// The one client that owns every given redirect URI, or null.
export function clientForRedirects(uris: readonly unknown[]): AssistantClient | null {
  if (uris.length === 0 || uris.length > 5) return null;
  return ASSISTANT_CLIENTS.find((c) => uris.every((u) => typeof u === "string" && c.redirectUris.includes(u))) ?? null;
}

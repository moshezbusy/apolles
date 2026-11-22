// Settings of the search-only AI assistant connector (plan 2026-11-22-mcp-search-connector).
// The connector is OFF unless both URLs are set and valid: every OAuth and assistant API route
// then answers 404. Set by the owner in the hosting provider, never in code.
//   APP_URL            the app's public URL; its origin is the OAuth issuer.
//   ASSISTANT_MCP_URL  the MCP server's public URL exactly as agents enter it in Claude or
//                      ChatGPT (e.g. https://mcp.apolles.com/mcp). Tokens are bound to it.

export type AssistantConfig = { issuer: string; mcpUrl: string };

type Env = Record<string, string | undefined>;

function safeUrl(raw: string | undefined, production: boolean): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.search || url.hash || url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  // Plain http only for local runs and tests, never in a production build.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return url.protocol === "http:" && local && !production ? url : null;
}

export function assistantConfig(env: Env = process.env): AssistantConfig | null {
  const production = env.NODE_ENV === "production";
  const app = safeUrl(env.APP_URL, production);
  const mcp = safeUrl(env.ASSISTANT_MCP_URL, production);
  if (!app || !mcp) return null;
  // The MCP URL as configured, character for character: Claude compares it to what the agent typed.
  return { issuer: app.origin, mcpUrl: env.ASSISTANT_MCP_URL as string };
}

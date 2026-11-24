import { z } from "zod";

// AI assistants, search only (plan 2026-11-22-mcp-search-connector).
//
// The connector is OFF until the owner sets MCP_PUBLIC_URL (the address agents paste into Claude
// or ChatGPT, e.g. https://mcp.example.com/mcp). While it is off, every OAuth endpoint answers 404
// and no assistant token works. The issuer of the tokens is this app (its APP_URL origin).

// The only scope that exists. Booking, cancellation, vouchers and the balance have no scope at
// all: no assistant token can reach them (they accept only the signed-in browser session).
export const ASSISTANT_SCOPE = "search:read";

export type AssistantConfig = { issuer: string; resource: string };

function url(raw: string | undefined): URL | null {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(raw);
  if (!parsed.success) return null;
  const value = new URL(parsed.data);
  // https only, except a local address for development and tests.
  if (value.protocol !== "https:" && value.hostname !== "localhost" && value.hostname !== "127.0.0.1") return null;
  if (value.username || value.password || value.hash || value.search) return null;
  return value;
}

export function assistantConfig(): AssistantConfig | null {
  const app = url(process.env.APP_URL);
  const raw = process.env.MCP_PUBLIC_URL?.trim();
  if (!app || !raw || !url(raw)) return null;
  // The resource is the connector address exactly as published: Claude and ChatGPT compare it
  // character for character with the address the agent pasted.
  return { issuer: app.origin, resource: raw };
}

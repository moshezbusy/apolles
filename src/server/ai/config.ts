import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Settings of the search-only AI connector (plan 11), read from the environment on each call.

const httpUrl = z.url({ protocol: /^https?$/ });

function readUrl(name: "APP_URL" | "MCP_PUBLIC_URL"): string {
  const parsed = httpUrl.safeParse(process.env[name]);
  if (!parsed.success) throw new Error(`${name} is not set to a valid http(s) URL`);
  return parsed.data.replace(/\/+$/, "");
}

// Off unless exactly "true": every AI route answers 404 and the tab is hidden.
export function aiSearchEnabled(): boolean {
  return process.env.AI_SEARCH_ENABLED === "true";
}

// The MCP server's address: the audience every assistant token is bound to.
export function mcpResource(): string {
  return `${readUrl("MCP_PUBLIC_URL")}/mcp`;
}

// The OAuth issuer (R3): the app's own public address, without a trailing slash.
export function appIssuer(): string {
  return readUrl("APP_URL");
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// The MCP server's own key. Compared as SHA-256 digests with timingSafeEqual, so neither the
// length nor the content leaks through timing. No key configured → nothing matches.
export function serviceKeyMatches(raw: string | null): boolean {
  const expected = process.env.AI_MCP_SERVICE_KEY;
  if (!expected || raw === null) return false;
  return timingSafeEqual(sha256(raw), sha256(expected));
}

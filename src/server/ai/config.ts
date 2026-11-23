import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Settings of the search-only AI connector (plan 11), read from the environment on each call.

const httpUrl = z.url({ protocol: /^https?$/ });
// openssl rand -base64 48 gives 64 characters; anything under 32 was typed by hand (F9).
export const MIN_SERVICE_KEY_LENGTH = 32;

function readUrl(name: "APP_URL" | "MCP_PUBLIC_URL"): string {
  const parsed = httpUrl.safeParse(process.env[name]);
  if (!parsed.success) throw new Error(`${name} is not set to a valid http(s) URL`);
  return parsed.data.replace(/\/+$/, "");
}

// Off unless exactly "true": every AI route answers 404 and the tab is hidden.
export function aiSearchEnabled(): boolean {
  return process.env.AI_SEARCH_ENABLED === "true";
}

// The MCP server's address: the audience every assistant token is bound to. Normalized the way
// the MCP server normalizes it (lower-case host, default port dropped, no trailing slash), so
// the same address written another way is the same audience on both sides (F8).
export function mcpResource(): string {
  const url = new URL(readUrl("MCP_PUBLIC_URL"));
  if (url.search || url.hash) throw new Error("MCP_PUBLIC_URL must not have a query or a fragment");
  return `${`${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "")}/mcp`;
}

// The OAuth issuer (R3): the app's own public address, without a trailing slash.
export function appIssuer(): string {
  return readUrl("APP_URL");
}

// The app's public host (lower case, no default port), or null when APP_URL is not valid. A
// request naming it came through the public proxy, never from the MCP server (F10).
export function appPublicHost(): string | null {
  try {
    return new URL(appIssuer()).host;
  } catch {
    return null;
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

let shortKeyReported = false;

// The MCP server's own key. Compared as SHA-256 digests with timingSafeEqual, so neither the
// length nor the content leaks through timing. No key configured, or one shorter than 32
// characters (said once in the log), → nothing matches.
export function serviceKeyMatches(raw: string | null): boolean {
  const expected = process.env.AI_MCP_SERVICE_KEY;
  if (!expected) return false;
  if (expected.length < MIN_SERVICE_KEY_LENGTH) {
    if (!shortKeyReported) {
      shortKeyReported = true;
      console.error("AI_MCP_SERVICE_KEY is shorter than 32 characters: the AI API refuses every call");
    }
    return false;
  }
  if (raw === null) return false;
  return timingSafeEqual(sha256(raw), sha256(expected));
}

import { z } from "zod";

// Settings of the MCP server (plan 11, task 8). The only file in src/mcp that reads the
// environment (a lint rule enforces it), and it reads exactly these five variables: the server
// has no database, no supplier keys and no other secret. Read once at start; a missing or bad
// value stops the server before it listens. Errors name the variable, never its value.

export type McpConfig = {
  publicUrl: string; // MCP_PUBLIC_URL: this server's public address, normalized (see publicAddress)
  internalUrl: string; // APOLLES_INTERNAL_URL: where the Apolles AI API is reached
  serviceKey: string; // AI_MCP_SERVICE_KEY: this server's key for the Apolles AI API, 32+ characters
  authServer: string; // APP_PUBLIC_URL: the OAuth issuer, the same string as the app's (R3)
  port: number; // PORT, default 8080
};

type Env = Readonly<Record<string, string | undefined>>;

// Assistants reach the public addresses over the internet: https only. The internal one is on
// the hosting provider's private network and may be plain http.
const publicUrl = z.url({ protocol: /^https$/ });
const internalUrl = z.url({ protocol: /^https?$/ });
const DEFAULT_PORT = 8080;
// openssl rand -base64 48 gives 64 characters; the app refuses a key under 32 as well.
const MIN_SERVICE_KEY_LENGTH = 32;

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is not set`);
  return value;
}

function urlOf(value: string | undefined, name: string, schema: typeof publicUrl, kind: string): string {
  const parsed = schema.safeParse(required(value, name));
  if (!parsed.success) throw new Error(`${name} must be ${kind} URL`);
  const { search, hash } = new URL(parsed.data);
  if (search || hash) throw new Error(`${name} must not have a query or a fragment`);
  return parsed.data.replace(/\/+$/, "");
}

// The address as the app reads MCP_PUBLIC_URL (src/server/ai/config.ts mcpResource): lower-case
// host, default port dropped, no trailing slash. The metadata's resource must be exactly the
// audience the app binds tokens to.
function publicAddress(value: string | undefined): string {
  const url = new URL(urlOf(value, "MCP_PUBLIC_URL", publicUrl, "an https"));
  return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
}

function serviceKey(value: string | undefined): string {
  const key = required(value, "AI_MCP_SERVICE_KEY");
  if (key.length < MIN_SERVICE_KEY_LENGTH) throw new Error(`AI_MCP_SERVICE_KEY must be at least ${MIN_SERVICE_KEY_LENGTH} characters`);
  return key;
}

function port(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const n = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN;
  if (!(n >= 1 && n <= 65_535)) throw new Error("PORT must be a number from 1 to 65535");
  return n;
}

export function loadConfig(env: Env = process.env): McpConfig {
  return {
    publicUrl: publicAddress(env.MCP_PUBLIC_URL),
    internalUrl: urlOf(env.APOLLES_INTERNAL_URL, "APOLLES_INTERNAL_URL", internalUrl, "an http(s)"),
    serviceKey: serviceKey(env.AI_MCP_SERVICE_KEY),
    authServer: urlOf(env.APP_PUBLIC_URL, "APP_PUBLIC_URL", publicUrl, "an https"),
    port: port(env.PORT),
  };
}

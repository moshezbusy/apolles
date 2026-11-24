import type { McpConfig } from "./server";

// What the MCP connector process needs, and what it must NOT have. It is the one process that
// faces Claude and ChatGPT, so it carries no secret at all: a database address, a supplier key, an
// email or 2FA key or bank details in its environment is a deployment mistake, and it refuses to
// start (the app container's environment file must never be given to it).

const FORBIDDEN = /^(DATABASE_URL|SHADOW_DATABASE_URL|EXPEDIA_|SUPPLIER_LAYER_|HOTELBEDS_|POSTMARK_|TOTP_|BANK_DETAILS_|SEED_ADMIN|POSTGRES_)/;

type Env = Record<string, string | undefined>;

function httpUrl(raw: string | undefined, httpsOnly: boolean): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && (httpsOnly || url.protocol !== "http:")) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

export function startupProblems(env: Env): string[] {
  const problems: string[] = [];
  const secrets = Object.keys(env).filter((name) => FORBIDDEN.test(name) && (env[name] ?? "") !== "");
  if (secrets.length > 0) problems.push(`Refusing to start: this process must hold no secrets, but these are set: ${secrets.sort().join(", ")}.`);
  const production = env.NODE_ENV === "production";
  if (production && !["staging", "production"].includes(env.APP_ENV ?? "")) problems.push("Refusing to start: APP_ENV must be staging or production.");
  const local = (u: URL | null) => u !== null && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  const resource = httpUrl(env.MCP_PUBLIC_URL, false);
  if (!resource || (resource.protocol !== "https:" && !local(resource))) problems.push("MCP_PUBLIC_URL must be the connector's public https address, e.g. https://mcp.example.com/mcp.");
  const app = httpUrl(env.APP_URL, false);
  if (!app || (app.protocol !== "https:" && !local(app))) problems.push("APP_URL must be the app's public https address (the sign-in server).");
  if (!httpUrl(env.APP_INTERNAL_URL, false)) problems.push("APP_INTERNAL_URL must be where this process reaches the app, e.g. http://apolles-staging:3000.");
  return problems;
}

export function mcpConfigFrom(env: Env, version: string): McpConfig {
  return {
    resource: (env.MCP_PUBLIC_URL ?? "").trim(),
    issuer: new URL((env.APP_URL ?? "").trim()).origin,
    appInternalUrl: new URL((env.APP_INTERNAL_URL ?? "").trim()).origin,
    version,
  };
}

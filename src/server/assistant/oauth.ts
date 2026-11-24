import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit } from "@/server/audit";
import { hashToken } from "@/server/auth/token";
import { db } from "@/server/db";
import { hitRateLimit } from "@/server/rate-limit";
import { ipBucket } from "@/server/client-ip";
import { ASSISTANT_SCOPE, assistantConfig } from "./config";
import { createConnection, refreshConnection, revokeConnectionById } from "./connections";

// The OAuth 2.1 authorization server for AI assistants (plan 2026-11-22-mcp-search-connector),
// as Claude and ChatGPT expect it for a remote MCP connector (their docs, checked 2026-11-24):
// authorization code + PKCE S256, dynamic client registration (RFC 7591), the `resource` parameter
// (RFC 8707) bound into the token, and `iss` in every authorization response (RFC 9207), so
// ChatGPT uses its stable redirect address.
//
// Deliberately narrow:
// - Only the redirect addresses of Claude and ChatGPT can be registered (REDIRECTS below). The
//   assistant's name the agent sees comes from that address, never from the client's own text.
// - Public clients only (no client secret), PKCE S256 required, scope search:read only.
// - No Client ID Metadata Documents: they would make this server fetch any URL a client names.
//   Claude and ChatGPT both fall back to dynamic registration when it is not advertised.
// - A redirect address that is not the client's registered one is never redirected to.

const REQUEST_TTL_MS = 10 * 60 * 1000; // the agent may need to sign in (email code) on the way
const CODE_TTL_MS = 2 * 60 * 1000;
const MAX_REDIRECTS = 5;
const REGISTER_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 }; // per network
const AUTHORIZE_LIMIT = { limit: 60, windowMs: 60 * 60 * 1000 }; // per network
const TOKEN_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 }; // per network

type Assistant = "Claude" | "ChatGPT";

// Exact addresses, plus ChatGPT's per-connection form (https://chatgpt.com/connector/oauth/{id}).
const REDIRECTS: { match: (uri: string) => boolean; name: Assistant }[] = [
  { match: (u) => u === "https://claude.ai/api/mcp/auth_callback", name: "Claude" },
  { match: (u) => u === "https://claude.com/api/mcp/auth_callback", name: "Claude" },
  { match: (u) => u === "https://chatgpt.com/connector_platform_oauth_redirect", name: "ChatGPT" },
  { match: (u) => /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,100}$/.test(u), name: "ChatGPT" },
];

export function assistantForRedirect(uri: string): Assistant | null {
  return REDIRECTS.find((r) => r.match(uri))?.name ?? null;
}

type JsonResult = { status: number; body: Record<string, unknown> };

const oauthError = (status: number, error: string, description?: string): JsonResult => ({
  status,
  body: { error, ...(description ? { error_description: description } : {}) },
});

function networkKey(action: string, ip: string): string {
  return `assistant-${action}:ip:${ipBucket(ip)}`;
}

async function limited(action: string, ip: string, rule: { limit: number; windowMs: number }): Promise<boolean> {
  return !(await hitRateLimit(networkKey(action, ip), rule.limit, rule.windowMs)).allowed;
}

// The authorization server metadata (RFC 8414), served at /.well-known/oauth-authorization-server.
export function authorizationServerMetadata(): Record<string, unknown> | null {
  const config = assistantConfig();
  if (!config) return null;
  const { issuer } = config;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [ASSISTANT_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

// ---------- dynamic client registration (RFC 7591) ----------

// Clients send many optional metadata fields (client_uri, logo_uri, software_id, ...). They are
// read for nothing and not stored: only the fields below are used, and those are checked strictly.
const registration = z.object({
  redirect_uris: z.array(z.string().max(300)).min(1).max(MAX_REDIRECTS),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).max(2).optional(),
  response_types: z.array(z.literal("code")).max(1).optional(),
  client_name: z.string().max(200).optional(),
});

export async function registerClient(raw: unknown, ip: string): Promise<JsonResult> {
  if (!assistantConfig()) return oauthError(404, "not_found");
  if (await limited("register", ip, REGISTER_LIMIT)) return oauthError(429, "slow_down", "Too many registrations. Try again later.");
  const parsed = registration.safeParse(raw);
  if (!parsed.success) return oauthError(400, "invalid_client_metadata");
  const uris = [...new Set(parsed.data.redirect_uris)];
  const names = uris.map(assistantForRedirect);
  if (names.some((n) => n === null)) return oauthError(400, "invalid_redirect_uri", "Only Claude and ChatGPT can connect.");
  if (new Set(names).size !== 1) return oauthError(400, "invalid_redirect_uri", "One assistant per registration.");
  const name = names[0] as Assistant;
  const id = `apc_${randomBytes(18).toString("base64url")}`;
  const row = await db.assistantClient.create({ data: { id, name, redirectUris: uris }, select: { id: true, createdAt: true } });
  return {
    status: 201,
    body: {
      client_id: row.id,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

// ---------- authorization ----------

export type AuthorizeResult =
  | { kind: "consent"; requestId: string } // open /oauth/consent/<id>
  | { kind: "redirect"; location: string } // an error, sent back to the assistant
  | { kind: "error_page"; message: string }; // cannot send anything back safely

function withParams(base: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

const PKCE = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_MAX = 500;

export async function startAuthorization(params: URLSearchParams, ip: string): Promise<AuthorizeResult> {
  const config = assistantConfig();
  if (!config) return { kind: "error_page", message: "AI assistants are not available." };
  if (await limited("authorize", ip, AUTHORIZE_LIMIT)) return { kind: "error_page", message: "Too many attempts. Try again later." };
  const one = (name: string) => {
    const all = params.getAll(name);
    return all.length === 1 ? all[0] : all.length === 0 ? undefined : null; // null: sent twice
  };
  const clientId = one("client_id");
  const redirectUri = one("redirect_uri");
  if (typeof clientId !== "string" || clientId.length > 64) return { kind: "error_page", message: "This sign-in link is not valid." };
  const client = await db.assistantClient.findUnique({ where: { id: clientId }, select: { id: true, redirectUris: true } });
  if (!client) return { kind: "error_page", message: "This sign-in link is not valid." };
  // Without a redirect_uri the only registered one is used (RFC 6749 3.1.2.3); with several, it must be sent.
  const target = typeof redirectUri === "string" ? redirectUri : redirectUri === undefined && client.redirectUris.length === 1 ? client.redirectUris[0] : null;
  if (!target || !client.redirectUris.includes(target)) return { kind: "error_page", message: "This sign-in link is not valid." };

  // From here on, mistakes go back to the assistant, with its state and our issuer (RFC 9207).
  const state = one("state");
  const back = (error: string): AuthorizeResult => ({
    kind: "redirect",
    location: withParams(target, { error, state: typeof state === "string" && state.length <= STATE_MAX ? state : null, iss: config.issuer }),
  });
  if (state === null || (typeof state === "string" && state.length > STATE_MAX)) return back("invalid_request");
  if (one("response_type") !== "code") return back("unsupported_response_type");
  const challenge = one("code_challenge");
  if (one("code_challenge_method") !== "S256" || typeof challenge !== "string" || !PKCE.test(challenge)) return back("invalid_request");
  const scope = one("scope");
  if (scope === null || (typeof scope === "string" && scope.trim() !== "" && scope.trim().split(/\s+/).some((s) => s !== ASSISTANT_SCOPE))) return back("invalid_scope");
  const resource = one("resource");
  if (resource === null || (resource !== undefined && resource !== config.resource)) return back("invalid_target");

  const id = randomBytes(24).toString("base64url");
  await db.assistantAuthRequest.create({
    data: {
      id,
      clientId: client.id,
      redirectUri: target,
      state: typeof state === "string" ? state : null,
      codeChallenge: challenge,
      resource: config.resource,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    },
  });
  return { kind: "consent", requestId: id };
}

const REQUEST_ID = /^[A-Za-z0-9_-]{32}$/;

// What the consent page shows: which assistant, and the host the agent will be sent back to.
export async function readAuthRequest(id: string, now: Date = new Date()): Promise<{ id: string; clientName: string; redirectHost: string } | null> {
  if (typeof id !== "string" || !REQUEST_ID.test(id)) return null;
  const row = await db.assistantAuthRequest.findFirst({
    where: { id, userId: null, expiresAt: { gt: now } },
    select: { id: true, redirectUri: true, client: { select: { name: true } } },
  });
  return row ? { id: row.id, clientName: row.client.name, redirectHost: new URL(row.redirectUri).host } : null;
}

// The agent clicked Allow. One conditional update claims the request for this agent, so it can be
// approved once. Returns where to send the browser (code, state, iss), or null.
export async function approveAuthRequest(who: { userId: string; agencyId: string }, id: string, now: Date = new Date()): Promise<string | null> {
  const config = assistantConfig();
  if (!config || typeof id !== "string" || !REQUEST_ID.test(id)) return null;
  const code = randomBytes(32).toString("base64url");
  return db.$transaction(async (tx) => {
    const claimed = await tx.assistantAuthRequest.updateManyAndReturn({
      where: { id, userId: null, expiresAt: { gt: now } },
      data: { userId: who.userId, agencyId: who.agencyId, codeHash: hashToken(code), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS) },
      select: { redirectUri: true, state: true, client: { select: { name: true } } },
    });
    const row = claimed[0];
    if (!row) return null;
    await audit(who.userId, "assistant.authorize", "AssistantAuthRequest", id, undefined, { client: row.client.name, scope: ASSISTANT_SCOPE }, tx);
    return withParams(row.redirectUri, { code, state: row.state, iss: config.issuer });
  });
}

// The agent clicked Cancel: the assistant is told access_denied.
export async function denyAuthRequest(id: string, now: Date = new Date()): Promise<string | null> {
  const config = assistantConfig();
  if (!config || typeof id !== "string" || !REQUEST_ID.test(id)) return null;
  const where = { id, userId: null, expiresAt: { gt: now } };
  const row = await db.assistantAuthRequest.findFirst({ where, select: { redirectUri: true, state: true } });
  if (!row || (await db.assistantAuthRequest.deleteMany({ where })).count !== 1) return null;
  return withParams(row.redirectUri, { error: "access_denied", state: row.state, iss: config.issuer });
}

// ---------- token endpoint ----------

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const MAX_FIELD = 300;

export async function exchangeToken(form: URLSearchParams, ip: string, now: Date = new Date()): Promise<JsonResult> {
  const config = assistantConfig();
  if (!config) return oauthError(404, "not_found");
  if (await limited("token", ip, TOKEN_LIMIT)) return oauthError(429, "slow_down");
  const field = (name: string): string | null => {
    const all = form.getAll(name);
    return all.length === 1 && (all[0] ?? "").length <= MAX_FIELD ? (all[0] ?? null) : null;
  };
  const grant = field("grant_type");
  const clientId = field("client_id");
  if (grant !== "authorization_code" && grant !== "refresh_token") return oauthError(400, "unsupported_grant_type");
  if (!clientId) return oauthError(400, "invalid_request");

  if (grant === "refresh_token") {
    const resource = form.get("resource");
    if (resource !== null && resource !== config.resource) return oauthError(400, "invalid_target");
    const refreshed = await refreshConnection(field("refresh_token") ?? "", clientId, now);
    if (!refreshed.ok) return oauthError(400, "invalid_grant");
    return { status: 200, body: tokenBody(refreshed.tokens) };
  }

  const code = field("code");
  const verifier = field("code_verifier");
  const redirectUri = field("redirect_uri");
  const resource = form.get("resource");
  if (!code || !verifier || !PKCE.test(verifier)) return oauthError(400, "invalid_grant");
  if (resource !== null && resource !== config.resource) return oauthError(400, "invalid_target");
  const codeHash = hashToken(code);

  const result = await db.$transaction(async (tx) => {
    // Claim the code once (usedAt). A code seen again is a replay: its connection is revoked below.
    const claimed = await tx.assistantAuthRequest.updateManyAndReturn({
      where: { codeHash, usedAt: null },
      data: { usedAt: now },
      select: { id: true, clientId: true, redirectUri: true, codeChallenge: true, codeExpiresAt: true, resource: true, userId: true, agencyId: true, client: { select: { name: true } } },
    });
    const row = claimed[0];
    if (!row) return { replay: true as const };
    const expected = createHash("sha256").update(verifier).digest("base64url");
    if (
      row.clientId !== clientId ||
      !row.codeExpiresAt ||
      row.codeExpiresAt <= now ||
      (redirectUri !== null && redirectUri !== row.redirectUri) ||
      row.resource !== config.resource ||
      !sameText(expected, row.codeChallenge) ||
      !row.userId ||
      !row.agencyId
    ) {
      return { refused: true as const };
    }
    // The agent and the agency must still be active (a suspension since the approval stops it).
    const user = await tx.user.findFirst({
      where: { id: row.userId, agencyId: row.agencyId, role: "AGENT", status: "ACTIVE", agency: { status: "ACTIVE" }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      select: { id: true },
    });
    if (!user) return { refused: true as const };
    const tokens = await createConnection(tx, { userId: row.userId, agencyId: row.agencyId, clientId: row.clientId, clientName: row.client.name, resource: row.resource }, now);
    // Remember which connection the code gave, so a replay can revoke it.
    await tx.assistantAuthRequest.update({ where: { id: row.id }, data: { connectionId: tokens.connectionId } });
    return { tokens };
  });

  if ("replay" in result) {
    const used = await db.assistantAuthRequest.findUnique({ where: { codeHash }, select: { connectionId: true } });
    if (used?.connectionId) await revokeConnectionById(used.connectionId, "code_reuse");
    return oauthError(400, "invalid_grant");
  }
  if ("refused" in result) return oauthError(400, "invalid_grant");
  return { status: 200, body: tokenBody(result.tokens) };
}

function tokenBody(tokens: { accessToken: string; refreshToken: string; expiresInSeconds: number }): Record<string, unknown> {
  return { access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresInSeconds, refresh_token: tokens.refreshToken, scope: ASSISTANT_SCOPE };
}

// Daily cleanup: sign-ins that were never finished, or finished more than a day ago.
export async function removeOldAuthRequests(now: Date = new Date()): Promise<number> {
  const result = await db.assistantAuthRequest.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  return result.count;
}

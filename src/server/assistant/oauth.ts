import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { MAX_RAW_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";
import { type AssistantClient, clientById } from "./clients";
import type { AssistantConfig } from "./config";

// OAuth 2.1 authorization code flow with PKCE (S256 only) for the search-only assistant
// connector. Public clients only (no client secret): the redirect URI allowlist (clients.ts)
// and PKCE are what keep a code from being used by anyone but the assistant the agent chose.
// - A code is single use and lives 5 minutes. It is spent on the first exchange attempt, right
//   or wrong; a second use also revokes the connection the first one made (RFC 6749 4.1.2).
// - The access token lives 7 days, can only search (scope search:read) and is bound to the MCP
//   URL (resource, RFC 8707). There are no refresh tokens: after 7 days the agent connects again.
// - Only SHA-256 hashes of codes and tokens are stored, never the raw values, never logged.

export const SCOPE = "search:read";
export const AUTH_CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
};

export type AuthorizeParse =
  | { ok: true; request: AuthorizeRequest }
  // The client or redirect URI cannot be trusted: show an error page, never redirect.
  | { ok: false; redirectable: false; message: string }
  // Trusted redirect URI, bad request: send the error back to the assistant.
  | { ok: false; redirectable: true; redirectUri: string; state: string | null; error: string };

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/; // base64url SHA-256, no padding
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_STATE = 1024;

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? undefined : value; // a repeated parameter is refused (RFC 6749 3.1)
}

// Only the search scope exists. No scope at all means the search scope.
function scopeOk(scope: string | undefined): boolean {
  if (scope === undefined || scope.trim() === "") return true;
  return scope.trim().split(/\s+/).every((s) => s === SCOPE);
}

export function parseAuthorizeRequest(params: Params, config: AssistantConfig): AuthorizeParse {
  const client = clientById(one(params, "client_id"));
  const redirectUri = one(params, "redirect_uri");
  if (!client) return { ok: false, redirectable: false, message: "This assistant is not known to Apolles." };
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, redirectable: false, message: "This sign-in link is not valid." };
  }
  const rawState = one(params, "state");
  const state = rawState && rawState.length <= MAX_STATE ? rawState : null;
  const fail = (error: string): AuthorizeParse => ({ ok: false, redirectable: true, redirectUri, state, error });

  if (rawState !== undefined && state === null) return fail("invalid_request");
  if (one(params, "response_type") !== "code") return fail("unsupported_response_type");
  const challenge = one(params, "code_challenge");
  if (one(params, "code_challenge_method") !== "S256" || !challenge || !CHALLENGE.test(challenge)) return fail("invalid_request");
  if (!scopeOk(one(params, "scope"))) return fail("invalid_scope");
  const resource = one(params, "resource");
  if (resource !== undefined && resource !== config.mcpUrl) return fail("invalid_target");

  return {
    ok: true,
    request: { clientId: client.clientId, clientName: client.name, redirectUri, codeChallenge: challenge, state, resource: config.mcpUrl },
  };
}

// The agent pressed "Allow". The caller has checked the agent session (requireAgent) and gives
// the userId and agencyId from it. Returns the raw code for the redirect.
export async function issueAuthCode(
  agent: { userId: string; agencyId: string },
  request: AuthorizeRequest,
  now: Date = new Date(),
): Promise<string> {
  const raw = generateRawToken();
  await db.assistantAuthCode.create({
    data: {
      codeHash: hashToken(raw),
      clientId: request.clientId,
      userId: agent.userId,
      agencyId: agent.agencyId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
      createdAt: now,
    },
  });
  // Old codes are of no use: drop the ones that expired over an hour ago.
  await db.assistantAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60_000) } } });
  return raw;
}

// Where the agent is sent after Allow or Cancel (RFC 6749 4.1.2, RFC 9207 iss).
export function redirectWith(redirectUri: string, params: Record<string, string | null>, issuer: string): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value);
  url.searchParams.set("iss", issuer);
  return url.toString();
}

const tokenForm = z
  .object({
    grant_type: z.string().max(100),
    code: z.string().min(1).max(MAX_RAW_TOKEN_LENGTH).optional(),
    redirect_uri: z.string().max(2000).optional(),
    client_id: z.string().max(200).optional(),
    code_verifier: z.string().max(200).optional(),
    resource: z.string().max(2000).optional(),
    scope: z.string().max(200).optional(),
  })
  .strict();

export type ExchangeResult =
  | { ok: true; accessToken: string; expiresIn: number; scope: string }
  | { ok: false; status: 400 | 401; error: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_scope" };

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const expected = Buffer.from(challenge);
  const actual = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const INVALID_GRANT = { ok: false, status: 400, error: "invalid_grant" } as const;

export async function exchangeCode(form: Record<string, string | undefined>, config: AssistantConfig, now: Date = new Date()): Promise<ExchangeResult> {
  const parsed = tokenForm.safeParse(form);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid_request" };
  const input = parsed.data;
  if (input.grant_type !== "authorization_code") return { ok: false, status: 400, error: "unsupported_grant_type" };
  const client: AssistantClient | null = clientById(input.client_id);
  if (!client) return { ok: false, status: 401, error: "invalid_client" };
  if (!input.code || !input.code_verifier || !input.redirect_uri) return { ok: false, status: 400, error: "invalid_request" };
  if (!scopeOk(input.scope)) return { ok: false, status: 400, error: "invalid_scope" };
  const { code, code_verifier: verifier, redirect_uri: redirectUri, resource } = input;

  return db.$transaction(async (tx): Promise<ExchangeResult> => {
    const row = await tx.assistantAuthCode.findUnique({ where: { codeHash: hashToken(code) } });
    if (!row) return INVALID_GRANT;
    // Spend the code first: whatever is wrong below, it cannot be tried again.
    const spent = await tx.assistantAuthCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (spent.count === 0) {
      // A code used twice was probably stolen: the connection it made is ended too.
      await tx.assistantConnection.updateMany({ where: { authCodeId: row.id, revokedAt: null }, data: { revokedAt: now } });
      return INVALID_GRANT;
    }
    if (row.expiresAt <= now) return INVALID_GRANT;
    if (row.clientId !== client.clientId || row.redirectUri !== redirectUri) return INVALID_GRANT;
    if (resource !== undefined && resource !== row.resource) return INVALID_GRANT;
    if (row.resource !== config.mcpUrl) return INVALID_GRANT;
    if (!pkceMatches(verifier, row.codeChallenge)) return INVALID_GRANT;
    // The agent and the agency must still be active, and the agent still in that agency.
    const agent = await tx.user.findFirst({
      where: { id: row.userId, agencyId: row.agencyId, role: "AGENT", status: "ACTIVE", agency: { status: "ACTIVE" } },
      select: { id: true },
    });
    if (!agent) return INVALID_GRANT;

    const accessToken = generateRawToken();
    const connection = await tx.assistantConnection.create({
      data: {
        agencyId: row.agencyId,
        userId: row.userId,
        clientId: client.clientId,
        clientName: client.name,
        tokenHash: hashToken(accessToken),
        scope: SCOPE,
        resource: row.resource,
        authCodeId: row.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    await audit(row.userId, "assistant.connect", "AssistantConnection", connection.id, undefined, { client: client.name, scope: SCOPE }, tx);
    return { ok: true, accessToken, expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), scope: SCOPE };
  });
}

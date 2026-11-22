import { z } from "zod";
import type { AiClient } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { hitRateLimit, type RateLimitResult } from "@/server/rate-limit";
import { appIssuer, mcpResource } from "@/server/ai/config";
import {
  assistantName,
  findKnownClient,
  isAllowedRedirectUri,
  readCappedText,
  resolveClient,
  type AssistantName,
} from "@/server/ai/clients";
import {
  AI_SCOPE,
  connectionIdForRefreshToken,
  exchangeCode,
  issueAuthCode,
  refresh,
  revokeByToken,
  // Not a React hook (lint goes by the "use" prefix).
  useConnectWindow as spendConnectWindow,
  type OAuthError,
  type TokenPair,
} from "@/server/ai/tokens";

// The OAuth 2.1 authorization server of the search-only AI connector (plan 11, design §4.1):
// the checks behind /oauth/authorize (consent page and its Allow / Deny), /oauth/token and
// /oauth/revoke. The routes and the page only read the request and send the answer.

const FIFTEEN_MINUTES = 15 * 60 * 1000;
export const AUTHORIZE_LIMIT = { limit: 120, windowMs: FIFTEEN_MINUTES };
export const TOKEN_CLIENT_LIMIT = { limit: 60, windowMs: FIFTEEN_MINUTES };
export const TOKEN_CONNECTION_LIMIT = { limit: 60, windowMs: FIFTEEN_MINUTES };
export const TOKEN_IP_LIMIT = { limit: 2000, windowMs: FIFTEEN_MINUTES };
export const REVOKE_IP_LIMIT = { limit: 120, windowMs: FIFTEEN_MINUTES };

const MAX_FIELD_LENGTH = 2000;
const MAX_STATE_LENGTH = 500;
const MAX_SCOPE_LENGTH = 200;
const SUPPORTED_SCOPES: ReadonlySet<string> = new Set([AI_SCOPE, "offline_access"]);
// An S256 challenge is base64url(sha256(verifier)): always 43 characters.
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

// Missing (or empty) means search:read. Otherwise every space-separated part must be one we
// support; offline_access only means "give a refresh token", which every grant does anyway.
function isSupportedScope(scope: string | undefined): boolean {
  if (scope === undefined || scope.trim() === "") return true;
  if (scope.length > MAX_SCOPE_LENGTH) return false;
  return scope
    .trim()
    .split(/ +/)
    .every((part) => SUPPORTED_SCOPES.has(part));
}

// ---------- Authorize ----------

export type AuthorizeParams = Record<string, string | string[] | undefined>;

// The fields of an authorize request (and of the consent form's hidden fields).
const AUTHORIZE_FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "resource",
  "scope",
  "state",
] as const;

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string | undefined;
  state?: string | undefined;
};

export type AuthorizeCheck =
  // Unknown client, or a redirect URI that client did not register: an error page in Apolles,
  // never a redirect (it could send the agent anywhere).
  | { kind: "invalid_link" }
  // Client and redirect URI are fine, the rest is not: the error goes back to the assistant.
  | { kind: "error"; redirectTo: string }
  | { kind: "ok"; request: AuthorizeRequest; client: AiClient; assistant: AssistantName };

// A repeated parameter (an array) is never accepted.
function single(value: string | string[] | undefined): string | undefined | null {
  return Array.isArray(value) ? null : value;
}

// The redirect back to the assistant: the given values plus `iss` (RFC 9207), on success and
// on every error. Only ever called with a redirect URI the client registered.
export function authorizationRedirect(redirectUri: string, values: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  url.searchParams.set("iss", appIssuer());
  return url.toString();
}

// The authorize request as a path, for the sign-in to come back to (requireAgent's returnTo).
export function authorizeReturnPath(params: AuthorizeParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  return `/oauth/authorize?${search.toString()}`;
}

// Checks an authorize request. The page passes the query (unknown parameters are ignored:
// assistants add their own); the Allow and Deny actions pass the consent form's hidden fields
// with `strict` (anything we did not put there means the form was changed).
export async function checkAuthorizeRequest(
  params: AuthorizeParams,
  { strict = false, fetchFn = fetch }: { strict?: boolean; fetchFn?: typeof fetch } = {},
): Promise<AuthorizeCheck> {
  if (strict && Object.keys(params).some((key) => !(AUTHORIZE_FIELDS as readonly string[]).includes(key))) {
    return { kind: "invalid_link" };
  }
  const clientId = single(params.client_id);
  const redirectUri = single(params.redirect_uri);
  if (typeof clientId !== "string" || typeof redirectUri !== "string" || redirectUri.length > MAX_FIELD_LENGTH) {
    return { kind: "invalid_link" };
  }
  const client = await resolveClient(clientId, fetchFn);
  // Exact string equality with one of THIS client's redirect URIs, and still on the allowlist.
  if (!client || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    return { kind: "invalid_link" };
  }
  const assistant = assistantName(redirectUri)!;

  const rawState = single(params.state);
  const stateOk = rawState === undefined || (typeof rawState === "string" && rawState.length <= MAX_STATE_LENGTH);
  const state = stateOk ? (rawState ?? undefined) : undefined;
  const fail = (error: string): AuthorizeCheck => ({ kind: "error", redirectTo: authorizationRedirect(redirectUri, { error, state }) });
  if (!stateOk) return fail("invalid_request");

  const responseType = single(params.response_type);
  if (typeof responseType !== "string") return fail("invalid_request");
  if (responseType !== "code") return fail("unsupported_response_type");

  // PKCE S256 is required; "plain" or no challenge is refused (OAuth 2.1 §4.1.2.1).
  const codeChallenge = single(params.code_challenge);
  if (single(params.code_challenge_method) !== "S256" || typeof codeChallenge !== "string" || !S256_CHALLENGE.test(codeChallenge)) {
    return fail("invalid_request");
  }
  // The token's audience must be our MCP server (RFC 8707). Claude and ChatGPT always send it.
  if (single(params.resource) !== mcpResource()) return fail("invalid_target");

  const scope = single(params.scope);
  if (scope === null) return fail("invalid_request");
  if (!isSupportedScope(scope)) return fail("invalid_scope");

  return { kind: "ok", client, assistant, request: { clientId, redirectUri, codeChallenge, scope, state } };
}

// The hidden fields of the consent form: the checked request, nothing else.
export function consentFields(request: AuthorizeRequest): Record<string, string> {
  const fields: Record<string, string> = {
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    resource: mcpResource(),
  };
  if (request.scope !== undefined) fields.scope = request.scope;
  if (request.state !== undefined) fields.state = request.state;
  return fields;
}

// Counted on every page load and Allow / Deny, before the client is looked up: resolving a
// CIMD client can fetch its document, which no one may make us do without limit.
export async function hitAuthorizeLimit(ip: string): Promise<boolean> {
  const { allowed } = await hitRateLimit(`ai-authorize:ip:${ip}`, AUTHORIZE_LIMIT.limit, AUTHORIZE_LIMIT.windowMs);
  return allowed;
}

// Allow: spends the connect window of this session (none open → null, nothing issued), then
// issues the code and returns the redirect back to the assistant.
export async function approveConnection(
  agent: { userId: string; sessionId: string },
  check: Extract<AuthorizeCheck, { kind: "ok" }>,
): Promise<string | null> {
  if (!(await spendConnectWindow(agent.userId, agent.sessionId))) return null;
  const { request, client, assistant } = check;
  const code = await issueAuthCode({
    userId: agent.userId,
    clientId: client.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: mcpResource(),
  });
  await audit(agent.userId, "ai.connect", "AiClient", client.id, undefined, { assistant });
  return authorizationRedirect(request.redirectUri, { code, state: request.state });
}

export function denyRedirect(check: Extract<AuthorizeCheck, { kind: "ok" }>): string {
  return authorizationRedirect(check.request.redirectUri, { error: "access_denied", state: check.request.state });
}

// ---------- Token and revoke endpoints ----------

export const MAX_FORM_BYTES = 8 * 1024;

export type EndpointResult = { status: number; json?: object; retryAfterS?: number };

function isFormEncoded(contentType: string | null): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded";
}

// The form fields of a token or revoke request, or null: not form-encoded, over 8 KB, or a
// field given twice (RFC 6749 §3.2: parameters must not be repeated).
export async function readForm(request: Request): Promise<Record<string, string> | null> {
  if (!isFormEncoded(request.headers.get("content-type"))) return null;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return null;
  const text = await readCappedText(request.body, MAX_FORM_BYTES);
  if (text === null) return null;
  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(text)) {
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  // fromEntries defines own properties, so a field named "__proto__" is just an unknown field.
  return Object.fromEntries(fields);
}

function oauthError(error: string, status = 400): EndpointResult {
  return { status, json: { error } };
}

function tooMany(limit: RateLimitResult): EndpointResult {
  return { status: 429, json: { error: "too_many_requests" }, retryAfterS: Math.max(1, Math.ceil(limit.retryAfterMs / 1000)) };
}

const field = z.string().min(1).max(MAX_FIELD_LENGTH);
const codeGrant = z
  .object({
    grant_type: z.literal("authorization_code"),
    code: field,
    redirect_uri: field,
    client_id: field,
    code_verifier: field,
    resource: field.optional(),
    scope: z.string().max(MAX_SCOPE_LENGTH).optional(),
  })
  .strict();
const refreshGrant = z
  .object({
    grant_type: z.literal("refresh_token"),
    refresh_token: field,
    client_id: field,
    resource: field.optional(),
    scope: z.string().max(MAX_SCOPE_LENGTH).optional(),
  })
  .strict();

function tokenAnswer(result: TokenPair | OAuthError): EndpointResult {
  if ("error" in result) return oauthError(result.error, result.error === "invalid_client" ? 401 : 400);
  return {
    status: 200,
    json: {
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    },
  };
}

// POST /oauth/token. Limits: 2,000 per 15 minutes per IP; 60 per DCR client; for refresh 60
// per connection (counted once the refresh token's row is found, before anything is issued).
// A code is single use, so the code grant needs no per-connection limit. Each is one indexed statement, so the answer stays well
// inside an assistant's 10-second token timeout.
export async function handleTokenRequest(fields: Record<string, string> | null, ip: string): Promise<EndpointResult> {
  const byIp = await hitRateLimit(`ai-token:ip:${ip}`, TOKEN_IP_LIMIT.limit, TOKEN_IP_LIMIT.windowMs);
  if (!byIp.allowed) return tooMany(byIp);
  if (fields === null || fields.grant_type === undefined) return oauthError("invalid_request");
  if (fields.grant_type !== "authorization_code" && fields.grant_type !== "refresh_token") {
    return oauthError("unsupported_grant_type");
  }

  const parsed = fields.grant_type === "authorization_code" ? codeGrant.safeParse(fields) : refreshGrant.safeParse(fields);
  if (!parsed.success) return oauthError("invalid_request");
  const input = parsed.data;
  if (!isSupportedScope(input.scope)) return oauthError("invalid_scope");
  if (input.resource !== mcpResource()) return oauthError("invalid_target");

  const client = await findKnownClient(input.client_id);
  if (!client) return oauthError("invalid_client", 401);
  // Per client only for DCR clients (one registration each). Every Claude (or ChatGPT) user
  // sends the same CIMD client_id, so one bucket for it would be shared by all their agents and
  // anyone could use it up; those are limited per connection (refresh) and per IP.
  if (client.clientIdUrl === null) {
    const byClient = await hitRateLimit(`ai-token:client:${client.id}`, TOKEN_CLIENT_LIMIT.limit, TOKEN_CLIENT_LIMIT.windowMs);
    if (!byClient.allowed) return tooMany(byClient);
  }

  if (input.grant_type === "authorization_code") {
    return tokenAnswer(
      await exchangeCode({
        code: input.code,
        clientId: client.id,
        redirectUri: input.redirect_uri,
        codeVerifier: input.code_verifier,
        resource: input.resource,
      }),
    );
  }
  const connectionId = await connectionIdForRefreshToken(input.refresh_token);
  if (connectionId !== null) {
    const byConnection = await hitRateLimit(
      `ai-token:connection:${connectionId}`,
      TOKEN_CONNECTION_LIMIT.limit,
      TOKEN_CONNECTION_LIMIT.windowMs,
    );
    if (!byConnection.allowed) return tooMany(byConnection);
  }
  return tokenAnswer(await refresh({ refreshToken: input.refresh_token, clientId: client.id, resource: input.resource }));
}

const revokeBody = z
  .object({
    token: field,
    token_type_hint: z.string().max(100).optional(),
    client_id: field,
  })
  .strict();

// POST /oauth/revoke (RFC 7009). A well-formed request always gets 200, whether the token was
// known, already revoked or another client's: the answer tells nothing about tokens.
export async function handleRevokeRequest(fields: Record<string, string> | null, ip: string): Promise<EndpointResult> {
  const byIp = await hitRateLimit(`ai-revoke:ip:${ip}`, REVOKE_IP_LIMIT.limit, REVOKE_IP_LIMIT.windowMs);
  if (!byIp.allowed) return tooMany(byIp);
  const parsed = revokeBody.safeParse(fields);
  if (!parsed.success) return oauthError("invalid_request");
  await revokeByToken(parsed.data.token, parsed.data.client_id);
  return { status: 200 };
}

// The answer of the token and revoke endpoints: never cached (RFC 6749 §5.1).
export function endpointResponse(result: EndpointResult): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Pragma: "no-cache" };
  if (result.retryAfterS !== undefined) headers["Retry-After"] = String(result.retryAfterS);
  if (result.json === undefined) return new Response(null, { status: result.status, headers });
  return Response.json(result.json, { status: result.status, headers });
}

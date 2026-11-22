import { z } from "zod";
import { Prisma, type AiClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { hitRateLimit } from "@/server/rate-limit";

// OAuth clients of the search-only AI connector (plan 11, design §4.1): Claude and ChatGPT
// register by Dynamic Client Registration (RFC 7591, POST /oauth/register) or present a Client
// ID Metadata Document URL as their client_id (CIMD). Both are tied to the redirect URI
// allowlist; a client's display name comes from its redirect URIs, never from what it sends.

export type AssistantName = "Claude" | "ChatGPT";

// The only redirect URIs any client may use (Global Constraints). Exact strings, no
// normalization: a trailing slash or a query string is a different URI and is refused.
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CHATGPT_CALLBACK = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;

// The only client-id URLs we fetch (R5). The hosts are fixed, so no client can make the app
// fetch an address of its choosing (no SSRF).
const CLAUDE_CIMD = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CHATGPT_CIMD = "https://chatgpt.com/oauth/client.json";
const CHATGPT_CIMD_PER_CONNECTOR = /^https:\/\/chatgpt\.com\/oauth\/[A-Za-z0-9_-]{1,128}\/client\.json$/;

export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_MAX_BYTES = 64 * 1024;
// A cached document is used as is for 24 hours; after that it is fetched again. If that fetch
// fails for a passing reason (network, timeout, 5xx), the cached copy is still trusted for up to
// 7 days (an outage at the assistant's side should not cut every agent off at once).
const CIMD_FRESH_MS = 24 * 60 * 60 * 1000;
const CIMD_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_CLIENT_ID_LENGTH = 200;
const MAX_URI_LENGTH = 2000;

export const REGISTER_LIMIT = { limit: 100, windowMs: 60 * 60 * 1000 };

const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const SCOPES = new Set(["search:read", "offline_access"]);

// "Claude" / "ChatGPT" for a redirect URI on the allowlist, null for anything else.
export function assistantName(redirectUri: string): AssistantName | null {
  if (redirectUri === CLAUDE_REDIRECT) return "Claude";
  if (redirectUri === CHATGPT_REDIRECT || CHATGPT_CALLBACK.test(redirectUri)) return "ChatGPT";
  return null;
}

export function isAllowedRedirectUri(redirectUri: string): boolean {
  return assistantName(redirectUri) !== null;
}

// The assistant a client-id URL belongs to, or null when it is not on the CIMD allowlist.
function cimdAssistant(url: string): AssistantName | null {
  if (url === CLAUDE_CIMD) return "Claude";
  if (url === CHATGPT_CIMD || CHATGPT_CIMD_PER_CONNECTOR.test(url)) return "ChatGPT";
  return null;
}

// All URIs must be on the allowlist and belong to one assistant; returns that assistant.
function singleAssistant(redirectUris: string[]): AssistantName | null {
  const names = new Set(redirectUris.map(assistantName));
  if (names.size !== 1) return null;
  const [name] = names;
  return name ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

type CappedRead = { kind: "ok"; text: string } | { kind: "too_large" } | { kind: "not_utf8" } | { kind: "failed" };

// Reads a body up to `maxBytes`, as UTF-8 text. Stops reading (and cancels the stream) as soon
// as the limit is passed, so a huge or endless body costs at most `maxBytes` of memory.
// "failed" = the stream broke (network error or timeout while reading).
async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<CappedRead> {
  if (!body) return { kind: "ok", text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { kind: "failed" };
  }
  try {
    return { kind: "ok", text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) };
  } catch {
    return { kind: "not_utf8" };
  }
}

// Same, as text or null (over the limit, not valid UTF-8, or the stream failed).
export async function readCappedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  const result = await readCapped(body, maxBytes);
  return result.kind === "ok" ? result.text : null;
}

// ---------- Dynamic Client Registration (RFC 7591) ----------

const uriField = z.string().min(1).max(MAX_URI_LENGTH);

// Every field we accept; anything else is refused. client_name and the informational fields
// (client_uri, logo_uri, contacts, software_id, software_version) are accepted, not stored.
const registrationBody = z
  .object({
    redirect_uris: z.array(uriField).min(1).max(5),
    client_name: z.string().max(100).optional(),
    token_endpoint_auth_method: z.literal("none").optional(),
    grant_types: z.array(z.enum(GRANT_TYPES)).min(1).max(GRANT_TYPES.length).optional(),
    response_types: z.tuple([z.literal("code")]).optional(),
    scope: z
      .string()
      .max(200)
      .refine((value) => {
        const parts = value.trim().split(/ +/);
        return parts.every((part) => SCOPES.has(part));
      })
      .optional(),
    client_uri: uriField.optional(),
    logo_uri: uriField.optional(),
    contacts: z.array(z.string().min(1).max(320)).max(10).optional(),
    software_id: z.string().max(200).optional(),
    software_version: z.string().max(100).optional(),
  })
  .strict();

export type RegisterResult =
  | { status: 201; json: object }
  | { status: 400 | 429; json: { error: string; error_description?: string } };

function registrationError(error: "invalid_client_metadata" | "invalid_redirect_uri", description: string): RegisterResult {
  return { status: 400, json: { error, error_description: description } };
}

// Registers a public client. `body` is the parsed JSON body (undefined when the route could not
// read one). The request is counted against the IP's limit before anything else, so invalid
// requests count too.
export async function registerClient(body: unknown, ip: string): Promise<RegisterResult> {
  const { allowed } = await hitRateLimit(`ai-register:ip:${ip}`, REGISTER_LIMIT.limit, REGISTER_LIMIT.windowMs);
  if (!allowed) {
    return { status: 429, json: { error: "too_many_requests", error_description: "Too many registrations. Try again later." } };
  }

  const parsed = registrationBody.safeParse(body);
  if (!parsed.success) {
    return registrationError("invalid_client_metadata", "The client metadata is not accepted by this server.");
  }

  const redirectUris = unique(parsed.data.redirect_uris);
  const name = singleAssistant(redirectUris);
  if (name === null) {
    return registrationError("invalid_redirect_uri", "One or more redirect URIs are not allowed by this server.");
  }

  const client = await db.aiClient.create({ data: { name, redirectUris } });
  // The server decides what the client gets (RFC 7591 §3.2.1): always a public client with the
  // code and refresh grants, whatever subset it asked for.
  return {
    status: 201,
    json: {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: [...GRANT_TYPES],
      response_types: ["code"],
    },
  };
}

// ---------- Client ID Metadata Documents ----------

// Only the fields we use. Other fields of the document are dropped, like unknown fields in
// supplier responses: the assistant may add fields at any time.
const cimdDocument = z.object({
  client_id: z.string().max(MAX_CLIENT_ID_LENGTH),
  redirect_uris: z.array(z.string().min(1).max(MAX_URI_LENGTH)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
});

type CimdFailure = "network" | "server_error" | "status" | "too_large" | "not_json" | "invalid";

// Only a failure that says nothing about the document (network error, timeout, 5xx) lets a
// recently cached copy stand in. A 4xx, a redirect or a document that fails our checks means
// the assistant changed or removed it, so the cached copy is not used either.
const TRANSIENT_FAILURES: ReadonlySet<CimdFailure> = new Set(["network", "server_error"]);

type CimdResult = { ok: true; redirectUris: string[] } | { ok: false; transient: boolean };

function cimdFailure(url: string, reason: CimdFailure): CimdResult {
  console.warn("AI client metadata fetch failed", { clientIdUrl: url, reason });
  return { ok: false, transient: TRANSIENT_FAILURES.has(reason) };
}

// Fetches and checks the document at an allowlisted client-id URL. A redirect is a failure
// (redirect: "manual", status must be 200).
async function fetchCimd(url: string, assistant: AssistantName, fetchFn: typeof fetch): Promise<CimdResult> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
  } catch {
    return cimdFailure(url, "network");
  }
  if (response.status !== 200 || response.redirected) {
    await response.body?.cancel().catch(() => undefined);
    return cimdFailure(url, response.status >= 500 && response.status <= 599 ? "server_error" : "status");
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CIMD_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return cimdFailure(url, "too_large");
  }
  const body = await readCapped(response.body, CIMD_MAX_BYTES);
  if (body.kind === "failed") return cimdFailure(url, "network");
  if (body.kind === "too_large") return cimdFailure(url, "too_large");
  if (body.kind === "not_utf8") return cimdFailure(url, "not_json");
  let json: unknown;
  try {
    json = JSON.parse(body.text);
  } catch {
    return cimdFailure(url, "not_json");
  }
  const parsed = cimdDocument.safeParse(json);
  // The document must name itself, be a public client, and list only redirect URIs of the
  // assistant that owns the URL.
  if (!parsed.success || parsed.data.client_id !== url) return cimdFailure(url, "invalid");
  const redirectUris = unique(parsed.data.redirect_uris);
  if (singleAssistant(redirectUris) !== assistant) return cimdFailure(url, "invalid");
  return { ok: true, redirectUris };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Caches the document in AiClient. For a CIMD row, createdAt is the time of the last
// successful fetch (that is what the 24-hour and 7-day rules measure); the row id stays the
// same, so existing connections keep pointing at it.
async function saveCimd(url: string, name: AssistantName, redirectUris: string[]): Promise<AiClient | null> {
  const data = { name, redirectUris, createdAt: new Date() };
  try {
    return await db.aiClient.upsert({ where: { clientIdUrl: url }, create: { clientIdUrl: url, ...data }, update: data });
  } catch (error) {
    // Two first fetches at once: the other one created the row.
    if (isUniqueViolation(error)) return db.aiClient.findUnique({ where: { clientIdUrl: url } });
    throw error;
  }
}

// A client_id with a URL scheme is a CIMD URL; DCR ids (cuid) never contain ":".
function looksLikeUrl(clientId: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(clientId);
}

// The client behind a client_id, or null. A URL is fetched only when it is on the CIMD
// allowlist (any other URL → null without fetching); anything else is a DCR client id. A cached
// CIMD row cannot be used by its internal id.
export async function resolveClient(clientId: string, fetchFn: typeof fetch = fetch): Promise<AiClient | null> {
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > MAX_CLIENT_ID_LENGTH) return null;
  if (!looksLikeUrl(clientId)) {
    return db.aiClient.findFirst({ where: { id: clientId, clientIdUrl: null } });
  }

  const assistant = cimdAssistant(clientId);
  if (assistant === null) return null;

  const cached = await db.aiClient.findUnique({ where: { clientIdUrl: clientId } });
  const age = cached ? Date.now() - cached.createdAt.getTime() : Number.POSITIVE_INFINITY;
  if (cached && age < CIMD_FRESH_MS) return cached;

  const fetched = await fetchCimd(clientId, assistant, fetchFn);
  if (fetched.ok) return saveCimd(clientId, assistant, fetched.redirectUris);
  return fetched.transient && cached && age < CIMD_STALE_MAX_MS ? cached : null;
}

// The client behind a client_id at the token and revoke endpoints: a lookup only, never a fetch
// (the token answer must be fast, and the authorize step already checked the document and saved
// the row). A CIMD client is found only by its URL, a DCR client only by its own id.
export async function findKnownClient(clientId: string): Promise<AiClient | null> {
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > MAX_CLIENT_ID_LENGTH) return null;
  if (looksLikeUrl(clientId)) {
    return cimdAssistant(clientId) === null ? null : db.aiClient.findUnique({ where: { clientIdUrl: clientId } });
  }
  return db.aiClient.findFirst({ where: { id: clientId, clientIdUrl: null } });
}

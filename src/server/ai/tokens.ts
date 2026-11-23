import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { MAX_RAW_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";

// Tokens of the search-only AI connector (plan 11, design §4.1-4.2). Codes and tokens are
// 32 random bytes; only their SHA-256 is stored (hashToken), never the raw value. Each
// successful code exchange creates its own connection (R7); revoking a connection ends every
// token under it at once.

export const AI_SCOPE = "search:read";
export const AUTH_CODE_TTL_MS = 60 * 1000;
export const ACCESS_TOKEN_TTL_S = 3600;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CONNECT_WINDOW_TTL_MS = 10 * 60 * 1000;

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: typeof ACCESS_TOKEN_TTL_S;
  scope: typeof AI_SCOPE;
};
export type OAuthError = { error: "invalid_grant" | "invalid_request" | "invalid_scope" | "invalid_client" };

export type RevokeReason =
  | "agent_revoke"
  | "code_reuse"
  | "refresh_reuse"
  | "agency_suspended"
  | "password_set"
  | "lockout"
  | "client_revoke";

const INVALID_GRANT: OAuthError = { error: "invalid_grant" };
const INVALID_REQUEST: OAuthError = { error: "invalid_request" };

// RFC 7636: 43-128 unreserved characters. An S256 challenge is base64url(sha256) = 43 chars.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const id = z.string().min(1).max(200);
const uri = z.string().min(1).max(2000);

const issueInput = z
  .object({ userId: id, clientId: id, redirectUri: uri, codeChallenge: z.string().regex(S256_CHALLENGE), resource: uri })
  .strict();
const exchangeInput = z
  .object({ code: z.string(), clientId: id, redirectUri: uri, codeVerifier: z.string(), resource: uri })
  .strict();
const refreshInput = z.object({ refreshToken: z.string(), clientId: id, resource: uri }).strict();

function isPlausibleToken(raw: string): boolean {
  return raw.length > 0 && raw.length <= MAX_RAW_TOKEN_LENGTH;
}

// PKCE S256 only: base64url(sha256(verifier)) must equal the stored challenge.
function pkceMatches(codeVerifier: string, codeChallenge: string): boolean {
  const computed = Buffer.from(createHash("sha256").update(codeVerifier).digest("base64url"));
  const expected = Buffer.from(codeChallenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

type AccountState = {
  role: "ADMIN" | "AGENT";
  status: "ACTIVE" | "SUSPENDED";
  agencyId: string | null;
  agency: { status: "ACTIVE" | "SUSPENDED" } | null;
};
const accountSelect = {
  role: true,
  status: true,
  agencyId: true,
  agency: { select: { status: true } },
} as const;

// Only an active agent of an active agency holds assistant tokens (no admin tokens exist).
function isActiveAgent(user: AccountState): boolean {
  return user.status === "ACTIVE" && user.role === "AGENT" && user.agency?.status === "ACTIVE";
}

// ---------- Connect window ----------

// "Connect assistant" in the AI assistants tab: for 10 minutes, this session may Allow one
// assistant. A newer window replaces any older open one of the user.
export async function openConnectWindow(userId: string, sessionId: string): Promise<void> {
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.aiConnectWindow.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    await tx.aiConnectWindow.create({
      data: { userId, sessionId, expiresAt: new Date(now.getTime() + CONNECT_WINDOW_TTL_MS) },
    });
  });
}

// One conditional UPDATE: of parallel Allow clicks only one finds the window still open.
export async function useConnectWindow(userId: string, sessionId: string): Promise<boolean> {
  const now = new Date();
  const { count } = await db.aiConnectWindow.updateMany({
    where: { userId, sessionId, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return count > 0;
}

// For the consent page: is there an open window of this user, started by this session? Only a
// read; Allow spends the window with useConnectWindow.
export async function hasOpenConnectWindow(userId: string, sessionId: string): Promise<boolean> {
  const open = await db.aiConnectWindow.findFirst({
    where: { userId, sessionId, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return open !== null;
}

// ---------- Authorization code ----------

// Called after the agent clicked Allow (the caller checked session, role and window).
// Returns the raw code, which goes only into the redirect to the assistant.
export async function issueAuthCode(i: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}): Promise<string> {
  const input = issueInput.parse(i);
  const raw = generateRawToken();
  await db.aiAuthCode.create({
    data: {
      codeHash: hashToken(raw),
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return raw;
}

async function createTokenPair(
  tx: Prisma.TransactionClient,
  connectionId: string,
  now: Date,
): Promise<TokenPair> {
  const accessToken = generateRawToken();
  const refreshToken = generateRawToken();
  await tx.aiToken.create({
    data: {
      connectionId,
      accessHash: hashToken(accessToken),
      refreshHash: hashToken(refreshToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, scope: AI_SCOPE };
}

// Theft signal (a code or refresh token used twice): ends one connection and every token
// under it. The audit row names the connection's own agent as actor (no person clicked
// anything); only the call that actually revoked it writes one.
async function revokeStolen(
  tx: Prisma.TransactionClient,
  connectionId: string,
  reason: "code_reuse" | "refresh_reuse",
): Promise<void> {
  const { count } = await tx.aiConnection.updateMany({
    where: { id: connectionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connectionId } });
  if (count !== 1) return;
  const { userId } = await tx.aiConnection.findUniqueOrThrow({ where: { id: connectionId }, select: { userId: true } });
  await audit(userId, "ai.revoke", "AiConnection", connectionId, undefined, { reason }, tx);
}

// authorization_code grant. Every check is made before the code is claimed, so a wrong
// verifier or redirect does not spend it. A code presented again after it was exchanged
// (or by the loser of a parallel exchange) revokes the connection it created: RFC 6749 §10.5,
// a reused code means someone else may hold it.
export async function exchangeCode(i: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
}): Promise<TokenPair | OAuthError> {
  const parsed = exchangeInput.safeParse(i);
  if (!parsed.success || !CODE_VERIFIER.test(parsed.data.codeVerifier)) return INVALID_REQUEST;
  const input = parsed.data;
  if (!isPlausibleToken(input.code)) return INVALID_GRANT;
  const codeHash = hashToken(input.code);

  return db.$transaction(async (tx) => {
    const now = new Date();
    const row = await tx.aiAuthCode.findUnique({
      where: { codeHash },
      select: {
        id: true,
        userId: true,
        clientId: true,
        redirectUri: true,
        codeChallenge: true,
        resource: true,
        expiresAt: true,
        usedAt: true,
        connectionId: true,
      },
    });
    if (!row) return INVALID_GRANT;
    if (row.usedAt !== null) {
      if (row.connectionId) await revokeStolen(tx, row.connectionId, "code_reuse");
      return INVALID_GRANT;
    }
    if (
      row.expiresAt.getTime() <= now.getTime() ||
      row.clientId !== input.clientId ||
      row.redirectUri !== input.redirectUri ||
      row.resource !== input.resource ||
      !pkceMatches(input.codeVerifier, row.codeChallenge)
    ) {
      return INVALID_GRANT;
    }

    // The user and agency rows are share-locked until commit, so a suspension, password reset or
    // lockout running at the same moment is ordered with this exchange: either it waits for this
    // exchange and then revokes the new connection, or it commits first and has marked every
    // unused code of the user as used, so the claim below finds nothing (invalid_grant). A
    // suspension is also seen in the status read here.
    const accounts = await tx.$queryRaw<
      { role: "ADMIN" | "AGENT"; status: "ACTIVE" | "SUSPENDED"; agencyId: string; agencyStatus: "ACTIVE" | "SUSPENDED" }[]
    >`
      SELECT u.role, u.status, u."agencyId", a.status AS "agencyStatus"
      FROM "User" u JOIN "Agency" a ON a.id = u."agencyId"
      WHERE u.id = ${row.userId}
      FOR SHARE`;
    const account = accounts[0];
    if (!account || !isActiveAgent({ ...account, agency: { status: account.agencyStatus } })) {
      return INVALID_GRANT;
    }

    // Claim: a parallel exchange waits on this row and then finds usedAt set.
    const claimed = await tx.aiAuthCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      const winner = await tx.aiAuthCode.findUnique({ where: { id: row.id }, select: { connectionId: true } });
      if (winner?.connectionId) await revokeStolen(tx, winner.connectionId, "code_reuse");
      return INVALID_GRANT;
    }

    const connection = await tx.aiConnection.create({
      data: {
        userId: row.userId,
        agencyId: account.agencyId,
        clientId: row.clientId,
        scope: AI_SCOPE,
        resource: row.resource,
      },
      select: { id: true },
    });
    await tx.aiAuthCode.update({ where: { id: row.id }, data: { connectionId: connection.id } });
    return createTokenPair(tx, connection.id, now);
  });
}

// refresh_token grant, rotated on every use. The old refresh token is claimed with one
// conditional UPDATE before the new pair is made (its access token ends at the same moment);
// an already-used token, or the loser of a parallel refresh, revokes the whole connection
// (theft signal) and gets invalid_grant.
export async function refresh(i: {
  refreshToken: string;
  clientId: string;
  resource: string;
}): Promise<TokenPair | OAuthError> {
  const parsed = refreshInput.safeParse(i);
  if (!parsed.success) return INVALID_REQUEST;
  const input = parsed.data;
  if (!isPlausibleToken(input.refreshToken)) return INVALID_GRANT;
  const refreshHash = hashToken(input.refreshToken);

  return db.$transaction(async (tx) => {
    // Lock the connection row first, so every refresh of one connection runs one after the
    // other and all writers take locks in the same order (connection, then tokens): without
    // it two parallel reuses can deadlock (one revoking and deleting the token rows the other
    // still holds from its failed claim). The full read below then sees the latest state.
    const ref = await tx.aiToken.findUnique({ where: { refreshHash }, select: { connectionId: true } });
    if (!ref) return INVALID_GRANT;
    await tx.$queryRaw`SELECT id FROM "AiConnection" WHERE id = ${ref.connectionId} FOR NO KEY UPDATE`;

    const now = new Date();
    const row = await tx.aiToken.findUnique({
      where: { refreshHash },
      select: {
        id: true,
        usedAt: true,
        refreshExpiresAt: true,
        connection: {
          select: {
            id: true,
            clientId: true,
            agencyId: true,
            scope: true,
            resource: true,
            revokedAt: true,
            user: { select: accountSelect },
          },
        },
      },
    });
    if (!row) return INVALID_GRANT;
    const connection = row.connection;
    if (
      connection.revokedAt !== null ||
      connection.clientId !== input.clientId ||
      connection.resource !== input.resource
    ) {
      return INVALID_GRANT;
    }
    if (row.usedAt !== null) {
      await revokeStolen(tx, connection.id, "refresh_reuse");
      return INVALID_GRANT;
    }
    if (
      row.refreshExpiresAt.getTime() <= now.getTime() ||
      connection.scope !== AI_SCOPE ||
      !isActiveAgent(connection.user) ||
      connection.user.agencyId !== connection.agencyId
    ) {
      return INVALID_GRANT;
    }

    // The old access token stops at once too: only the newest pair works.
    const claimed = await tx.aiToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now, accessExpiresAt: now },
    });
    if (claimed.count !== 1) {
      await revokeStolen(tx, connection.id, "refresh_reuse");
      return INVALID_GRANT;
    }
    // Spent pairs are kept (to spot reuse) until their refresh token would have expired anyway.
    await tx.aiToken.deleteMany({ where: { connectionId: connection.id, refreshExpiresAt: { lte: now } } });
    return createTokenPair(tx, connection.id, now);
  });
}

// The connection a refresh token belongs to (used or not), for the token endpoint's
// per-connection rate limit. One lookup on a unique index; null for an unknown token.
export async function connectionIdForRefreshToken(raw: string): Promise<string | null> {
  if (typeof raw !== "string" || !isPlausibleToken(raw)) return null;
  const row = await db.aiToken.findUnique({ where: { refreshHash: hashToken(raw) }, select: { connectionId: true } });
  return row?.connectionId ?? null;
}

// ---------- Token check (every AI API call) ----------

// Reads the database every time (no cache), so a revoke or a suspension stops the very next
// call. Checks: token known and not expired, connection open, scope search:read, bound to
// this resource, user ACTIVE with role AGENT, agency ACTIVE.
export async function verifyAiToken(
  raw: string,
  resource: string,
): Promise<{ connectionId: string; userId: string; agencyId: string } | null> {
  if (typeof raw !== "string" || !isPlausibleToken(raw)) return null;
  const row = await db.aiToken.findUnique({
    where: { accessHash: hashToken(raw) },
    select: {
      accessExpiresAt: true,
      connection: {
        select: {
          id: true,
          userId: true,
          agencyId: true,
          scope: true,
          resource: true,
          revokedAt: true,
          user: { select: accountSelect },
        },
      },
    },
  });
  if (!row || row.accessExpiresAt.getTime() <= Date.now()) return null;
  const c = row.connection;
  if (c.revokedAt !== null || c.scope !== AI_SCOPE || c.resource !== resource) return null;
  if (!isActiveAgent(c.user) || c.user.agencyId !== c.agencyId) return null;

  // Also re-checks "not revoked": a revoke that committed since the read above wins.
  const touched = await db.aiConnection.updateMany({
    where: { id: c.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
  if (touched.count !== 1) return null;
  return { connectionId: c.id, userId: c.userId, agencyId: c.agencyId };
}

// Whether an access token with this value was ever issued and its row is still kept (expired,
// refreshed away or bound to another resource included). Only for the AI API's failure path,
// to count made-up tokens apart from a normal assistant's old ones; never an access check.
// Rows of a revoked connection are deleted, so those tokens read as unknown.
export async function aiTokenExists(raw: string): Promise<boolean> {
  if (typeof raw !== "string" || !isPlausibleToken(raw)) return false;
  const row = await db.aiToken.findUnique({ where: { accessHash: hashToken(raw) }, select: { id: true } });
  return row !== null;
}

// ---------- Revoking ----------

// Revoke in the AI assistants tab. Scoped by the caller's agency: another agency's id (or an
// unknown or already revoked one) returns false and changes nothing.
export async function revokeConnection(
  agencyId: string,
  connectionId: string,
  actorUserId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.aiConnection.updateMany({
      where: { id: connectionId, agencyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "agent_revoke" },
    });
    if (count !== 1) return false;
    await tx.aiToken.deleteMany({ where: { connectionId } });
    await audit(actorUserId, "ai.revoke", "AiConnection", connectionId, undefined, { reason: "agent_revoke" }, tx);
    return true;
  });
}

// /oauth/revoke (RFC 7009): the assistant ends its own connection with its access or refresh
// token. `clientId` is the client_id the request named (a DCR id or a CIMD URL); a token of
// another client, or an unknown token, changes nothing, and the caller answers the same either
// way. Revoking ends the whole connection (every token under it), audited with the
// connection's own agent as actor.
export async function revokeByToken(raw: string, clientId: string): Promise<void> {
  if (typeof raw !== "string" || !isPlausibleToken(raw)) return;
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 200) return;
  const hash = hashToken(raw);
  const row = await db.aiToken.findFirst({
    where: { OR: [{ accessHash: hash }, { refreshHash: hash }] },
    select: { connection: { select: { id: true, userId: true, client: { select: { id: true, clientIdUrl: true } } } } },
  });
  if (!row) return;
  const { connection } = row;
  // A CIMD client is named by its URL; its internal row id is not a client_id.
  const owner = connection.client.clientIdUrl ?? connection.client.id;
  if (owner !== clientId) return;
  await db.$transaction(async (tx) => {
    const { count } = await tx.aiConnection.updateMany({
      where: { id: connection.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "client_revoke" },
    });
    await tx.aiToken.deleteMany({ where: { connectionId: connection.id } });
    if (count === 1) {
      await audit(connection.userId, "ai.revoke", "AiConnection", connection.id, undefined, { reason: "client_revoke" }, tx);
    }
  });
}

// Password set/reset and lockout: every open connection of the user ends, in the caller's
// transaction (the same one that ends the sessions). Unused codes and open connect windows
// end too: neither a reset nor a lockout changes the account status, so without this a code
// issued just before could still be exchanged afterwards. Returns how many connections were
// open; the caller writes the `ai.revoke_all` audit row with its own actor.
export async function revokeUserConnections(
  userId: string,
  reason: RevokeReason,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const now = new Date();
  await tx.aiAuthCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await tx.aiConnectWindow.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  const { count } = await tx.aiConnection.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connection: { userId } } });
  return count;
}

// Agency suspended: every open connection, unused code and open connect window of its users
// ends, in the suspension's transaction. Reactivation does not bring any of them back.
// Returns how many connections were open (caller audits).
export async function revokeAgencyConnections(
  agencyId: string,
  reason: RevokeReason,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const now = new Date();
  await tx.aiAuthCode.updateMany({ where: { user: { agencyId }, usedAt: null }, data: { usedAt: now } });
  await tx.aiConnectWindow.updateMany({ where: { user: { agencyId }, usedAt: null }, data: { usedAt: now } });
  const { count } = await tx.aiConnection.updateMany({
    where: { agencyId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connection: { agencyId } } });
  return count;
}

// ---------- Listing ----------

export type AssistantLabel = "Claude" | "ChatGPT" | "AI assistant";
export type ConnectionListItem = { id: string; assistant: AssistantLabel; createdAt: Date; lastUsedAt: Date | null };

const DEFAULT_CONNECTIONS_PAGE = 20;
const MAX_CONNECTIONS_PAGE = 50;

// Client names are set from the redirect URI at registration (task 4). Any other name still
// gets a row (so it can be revoked), under a neutral label.
function assistantLabel(name: string): AssistantLabel {
  return name === "Claude" || name === "ChatGPT" ? name : "AI assistant";
}

// The agency's open connections for the AI assistants tab: newest first (createdAt desc,
// id desc), `cursor` = id of the last connection of the previous page (same pattern as
// listAgencies). The cursor must be one of this agency's connections.
export async function listConnections(
  agencyId: string,
  cursor?: string,
  take = DEFAULT_CONNECTIONS_PAGE,
): Promise<{ connections: ConnectionListItem[]; nextCursor: string | null }> {
  const size = Number.isFinite(take)
    ? Math.min(MAX_CONNECTIONS_PAGE, Math.max(1, Math.trunc(take)))
    : DEFAULT_CONNECTIONS_PAGE;
  let where: Prisma.AiConnectionWhereInput = { agencyId, revokedAt: null };
  if (cursor !== undefined) {
    const after = await db.aiConnection.findFirst({
      where: { id: cursor, agencyId },
      select: { id: true, createdAt: true },
    });
    if (!after) throw new Error("Invalid cursor");
    where = {
      ...where,
      OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }],
    };
  }
  const rows = await db.aiConnection.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
    select: { id: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
  });
  const page = rows.slice(0, size);
  return {
    connections: page.map((r) => ({
      id: r.id,
      assistant: assistantLabel(r.client.name),
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    })),
    nextCursor: rows.length > size ? page[page.length - 1]!.id : null,
  };
}

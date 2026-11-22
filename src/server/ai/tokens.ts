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
  | "lockout";

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

// Ends one connection and every token under it. Returns false if it was already revoked.
async function revokeOne(
  tx: Prisma.TransactionClient,
  connectionId: string,
  reason: RevokeReason,
): Promise<boolean> {
  const { count } = await tx.aiConnection.updateMany({
    where: { id: connectionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connectionId } });
  return count === 1;
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
      if (row.connectionId) await revokeOne(tx, row.connectionId, "code_reuse");
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

    // The user and agency rows are share-locked until commit: a suspension, password reset or
    // lockout running at the same moment either waits for this exchange (and then revokes the
    // new connection) or commits first (and this exchange sees the account is no longer active).
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
      if (winner?.connectionId) await revokeOne(tx, winner.connectionId, "code_reuse");
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
// conditional UPDATE before the new pair is made; an already-used token, or the loser of a
// parallel refresh, revokes the whole connection (theft signal) and gets invalid_grant.
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
      await revokeOne(tx, connection.id, "refresh_reuse");
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

    const claimed = await tx.aiToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) {
      await revokeOne(tx, connection.id, "refresh_reuse");
      return INVALID_GRANT;
    }
    // Spent pairs are kept (to spot reuse) until their refresh token would have expired anyway.
    await tx.aiToken.deleteMany({ where: { connectionId: connection.id, refreshExpiresAt: { lte: now } } });
    return createTokenPair(tx, connection.id, now);
  });
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

// Password set/reset and lockout: every open connection of the user ends, in the caller's
// transaction (the same one that ends the sessions). Returns how many were open; the caller
// writes the `ai.revoke_all` audit row with its own actor.
export async function revokeUserConnections(
  userId: string,
  reason: RevokeReason,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const { count } = await tx.aiConnection.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connection: { userId } } });
  return count;
}

// Agency suspended: every open connection of its users ends, in the suspension's transaction.
// Reactivation does not bring them back. Returns how many were open (caller audits).
export async function revokeAgencyConnections(
  agencyId: string,
  reason: RevokeReason,
  tx: Prisma.TransactionClient,
): Promise<number> {
  const { count } = await tx.aiConnection.updateMany({
    where: { agencyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  await tx.aiToken.deleteMany({ where: { connection: { agencyId } } });
  return count;
}

// ---------- Listing ----------

const ASSISTANTS = ["Claude", "ChatGPT"] as const;
type Assistant = (typeof ASSISTANTS)[number];
// One agent per agency; each connect adds one row, so this is far above real use.
const MAX_LISTED_CONNECTIONS = 100;

function isAssistant(name: string): name is Assistant {
  return (ASSISTANTS as readonly string[]).includes(name);
}

// The agency's open connections, newest first, for the AI assistants tab.
export async function listConnections(agencyId: string): Promise<
  { id: string; assistant: Assistant; createdAt: Date; lastUsedAt: Date | null }[]
> {
  const rows = await db.aiConnection.findMany({
    where: { agencyId, revokedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_LISTED_CONNECTIONS,
    select: { id: true, createdAt: true, lastUsedAt: true, client: { select: { name: true } } },
  });
  // Client names are set from the redirect URI at registration (task 4), so only the two
  // names exist; anything else would be a bug and is not shown as a known assistant.
  return rows.flatMap((r) =>
    isAssistant(r.client.name)
      ? [{ id: r.id, assistant: r.client.name, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }]
      : [],
  );
}

import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { hashToken } from "@/server/auth/token";
import { db } from "@/server/db";
import { ASSISTANT_SCOPE, assistantConfig } from "./config";

// Connected AI assistants (plan 2026-11-22-mcp-search-connector): one row per agent and assistant.
//
// - Tokens are 32 random bytes with a prefix ("aplat_" access, "aplrt_" refresh), so a leaked one
//   is recognised by secret scanners. Only their SHA-256 is stored; the raw value is never logged.
// - An access token works for one hour, only for scope search:read, only for the connector address
//   it was issued for, and only while the agent and the agency are active and the agent is not
//   locked out. Each check reads the database, so a suspension or a lockout stops it at once.
// - A refresh gives a new access AND refresh token; the old refresh token, if it comes back, means
//   someone copied it, and the whole connection is revoked (OAuth 2.1 refresh token rotation).
// - Revoked on agency suspension, password change, lockout and the agent's own Revoke button.
//
// These tokens are read ONLY by the assistant search API (src/app/api/assistant/*). Every other
// entry point (bookings, cancellation, vouchers, statements, the balance, settings) accepts only
// the browser session cookie (src/server/auth/guards.ts), so an assistant token opens none of them.

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 128;
const LAST_USED_EVERY_MS = 60_000; // lastUsedAt is written at most once a minute per connection

export type RevokeReason = "agent_revoked" | "agency_suspended" | "password_changed" | "locked_out" | "refresh_reuse" | "code_reuse";

function newToken(prefix: "aplat_" | "aplrt_"): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresInSeconds: number };

// A new connection for an approved sign-in, inside the caller's transaction.
export async function createConnection(
  tx: Prisma.TransactionClient,
  input: { userId: string; agencyId: string; clientId: string; clientName: string; resource: string },
  now: Date,
): Promise<IssuedTokens & { connectionId: string }> {
  const accessToken = newToken("aplat_");
  const refreshToken = newToken("aplrt_");
  const row = await tx.assistantConnection.create({
    data: {
      ...input,
      scope: ASSISTANT_SCOPE,
      accessTokenHash: hashToken(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      createdAt: now,
    },
    select: { id: true },
  });
  await audit(input.userId, "assistant.connect", "AssistantConnection", row.id, undefined, { client: input.clientName, scope: ASSISTANT_SCOPE }, tx);
  return { connectionId: row.id, accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_MS / 1000 };
}

type Live = { userId: string; agencyId: string };

function accountOk(conn: { agencyId: string; user: { role: string; status: string; agencyId: string | null; lockedUntil: Date | null }; agency: { status: string } }, now: Date): boolean {
  const { user, agency } = conn;
  return user.role === "AGENT" && user.status === "ACTIVE" && user.agencyId === conn.agencyId && agency.status === "ACTIVE" && !(user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()); // not locked out (lockout.ts isLocked)
}

const accountSelect = {
  agencyId: true,
  user: { select: { role: true, status: true, agencyId: true, lockedUntil: true } },
  agency: { select: { status: true } },
} as const;

// The check behind every assistant API call. null: refuse (401). The agency comes only from here.
export async function verifyAccessToken(raw: unknown, now: Date = new Date()): Promise<({ connectionId: string } & Live) | null> {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TOKEN_LENGTH || !raw.startsWith("aplat_")) return null;
  const config = assistantConfig();
  if (!config) return null;
  const conn = await db.assistantConnection.findUnique({
    where: { accessTokenHash: hashToken(raw) },
    select: { id: true, userId: true, scope: true, resource: true, accessExpiresAt: true, revokedAt: true, lastUsedAt: true, ...accountSelect },
  });
  if (!conn || conn.revokedAt || conn.accessExpiresAt <= now) return null;
  if (conn.scope !== ASSISTANT_SCOPE || conn.resource !== config.resource) return null;
  if (!accountOk(conn, now)) return null;
  if (!conn.lastUsedAt || now.getTime() - conn.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await db.assistantConnection.updateMany({ where: { id: conn.id, revokedAt: null }, data: { lastUsedAt: now } });
  }
  return { connectionId: conn.id, userId: conn.userId, agencyId: conn.agencyId };
}

export type RefreshResult = { ok: true; tokens: IssuedTokens } | { ok: false };

// grant_type=refresh_token. One conditional update swaps the token pair, so of two refreshes with
// the same token only one wins. A refresh token that was already swapped revokes the connection.
export async function refreshConnection(raw: string, clientId: string, now: Date = new Date()): Promise<RefreshResult> {
  if (raw.length === 0 || raw.length > MAX_TOKEN_LENGTH || !raw.startsWith("aplrt_")) return { ok: false };
  const hash = hashToken(raw);
  const reused = await db.assistantConnection.findUnique({ where: { previousRefreshHash: hash }, select: { id: true, userId: true, revokedAt: true } });
  if (reused) {
    if (!reused.revokedAt) await revokeWhere({ id: reused.id }, "refresh_reuse", reused.userId);
    return { ok: false };
  }
  const conn = await db.assistantConnection.findUnique({
    where: { refreshTokenHash: hash },
    select: { id: true, clientId: true, revokedAt: true, refreshExpiresAt: true, resource: true, ...accountSelect },
  });
  const config = assistantConfig();
  if (!conn || !config || conn.revokedAt || conn.refreshExpiresAt <= now || conn.clientId !== clientId) return { ok: false };
  if (conn.resource !== config.resource || !accountOk(conn, now)) return { ok: false };
  const accessToken = newToken("aplat_");
  const refreshToken = newToken("aplrt_");
  const swapped = await db.assistantConnection.updateMany({
    where: { id: conn.id, refreshTokenHash: hash, revokedAt: null },
    data: {
      accessTokenHash: hashToken(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      refreshTokenHash: hashToken(refreshToken),
      previousRefreshHash: hash,
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  });
  if (swapped.count !== 1) return { ok: false };
  return { ok: true, tokens: { accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_MS / 1000 } };
}

async function revokeWhere(
  where: Prisma.AssistantConnectionWhereInput,
  reason: RevokeReason,
  actorUserId: string | null,
  tx: Prisma.TransactionClient = db,
): Promise<number> {
  const rows = await tx.assistantConnection.updateManyAndReturn({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
    select: { id: true, userId: true, clientName: true },
  });
  for (const row of rows) {
    await audit(actorUserId ?? row.userId, "assistant.revoke", "AssistantConnection", row.id, undefined, { client: row.clientName, reason }, tx);
  }
  return rows.length;
}

// Password change and lockout: every assistant of the user stops at once, and any sign-in the
// user approved but the assistant has not finished yet is dropped too.
export async function revokeUserAssistants(userId: string, reason: RevokeReason, tx: Prisma.TransactionClient = db): Promise<void> {
  await revokeWhere({ userId }, reason, userId, tx);
  await tx.assistantAuthRequest.deleteMany({ where: { userId } });
}

// Agency suspension (admin action): every assistant of every user of the agency.
export async function revokeAgencyAssistants(agencyId: string, actorUserId: string, tx: Prisma.TransactionClient = db): Promise<void> {
  await revokeWhere({ agencyId }, "agency_suspended", actorUserId, tx);
  await tx.assistantAuthRequest.deleteMany({ where: { agencyId } });
}

// Revoke after a code was used twice (OAuth 2.1: the tokens issued from that code are revoked).
export async function revokeConnectionById(connectionId: string, reason: RevokeReason): Promise<void> {
  await revokeWhere({ id: connectionId }, reason, null);
}

export type ConnectionListItem = { id: string; clientName: string; createdAt: Date; lastUsedAt: Date | null };

// Settings, "AI assistants": the agent's own live connections, newest first. A small list (one
// row per assistant the agent connected), capped at 50.
export async function listConnections(who: Live, now: Date = new Date()): Promise<ConnectionListItem[]> {
  return db.assistantConnection.findMany({
    where: { userId: who.userId, agencyId: who.agencyId, revokedAt: null, refreshExpiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, clientName: true, createdAt: true, lastUsedAt: true },
  });
}

// The agent's Revoke button. Only the agent's own connection (agency AND user): false otherwise.
export async function revokeConnection(who: Live, connectionId: string): Promise<boolean> {
  if (typeof connectionId !== "string" || connectionId.length === 0 || connectionId.length > 64) return false;
  return (await revokeWhere({ id: connectionId, userId: who.userId, agencyId: who.agencyId }, "agent_revoked", who.userId)) === 1;
}

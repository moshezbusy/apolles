import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { MAX_RAW_TOKEN_LENGTH, hashToken } from "@/server/auth/token";
import type { AssistantConfig } from "./config";
import { SCOPE } from "./oauth";

// Assistant connections (plan 2026-11-22-mcp-search-connector). An assistant token is checked
// here and ONLY here, by the assistant search API. It is not a session: getSession,
// requireAgent and requireAdmin read the session cookie only, so the token opens no booking,
// cancel, voucher, statement, balance or wallet entry point.

const LAST_USED_EVERY_MS = 60_000; // lastUsedAt is written at most once a minute per connection

export type AssistantCaller = { connectionId: string; userId: string; agencyId: string };

// Checked on every call, like sessions: a revoke or a suspension takes effect at once.
export async function verifyAccessToken(rawToken: string, config: AssistantConfig, now: Date = new Date()): Promise<AssistantCaller | null> {
  if (typeof rawToken !== "string" || rawToken.length === 0 || rawToken.length > MAX_RAW_TOKEN_LENGTH) return null;
  const row = await db.assistantConnection.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      agencyId: true,
      userId: true,
      scope: true,
      resource: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { role: true, status: true, agencyId: true } },
      agency: { select: { status: true } },
    },
  });
  if (!row || row.revokedAt || row.expiresAt <= now) return null;
  if (row.scope !== SCOPE || row.resource !== config.mcpUrl) return null;
  if (row.user.role !== "AGENT" || row.user.status !== "ACTIVE" || row.user.agencyId !== row.agencyId) return null;
  if (row.agency.status !== "ACTIVE") return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await db.assistantConnection.updateMany({ where: { id: row.id }, data: { lastUsedAt: now } });
  }
  return { connectionId: row.id, userId: row.userId, agencyId: row.agencyId };
}

export type ConnectionListItem = { id: string; clientName: string; userName: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date };

// The agency's active connections, newest first (Agency settings, "AI assistants"). One user per
// agency in phase 1, so the list is short; capped all the same.
export async function listConnections(agencyId: string, now: Date = new Date()): Promise<ConnectionListItem[]> {
  const rows = await db.assistantConnection.findMany({
    where: { agencyId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { id: true, clientName: true, createdAt: true, lastUsedAt: true, expiresAt: true, user: { select: { name: true } } },
  });
  return rows.map(({ user, ...row }) => ({ ...row, userName: user.name }));
}

// Revoke by the agent: only a connection of the agent's own agency. false = not found there.
export async function revokeConnection(actorUserId: string, agencyId: string, connectionId: string, now: Date = new Date()): Promise<boolean> {
  if (typeof connectionId !== "string" || connectionId.length === 0 || connectionId.length > 64) return false;
  return db.$transaction(async (tx) => {
    const result = await tx.assistantConnection.updateMany({ where: { id: connectionId, agencyId, revokedAt: null }, data: { revokedAt: now } });
    if (result.count === 0) return false;
    await audit(actorUserId, "assistant.revoke", "AssistantConnection", connectionId, undefined, undefined, tx);
    return true;
  });
}

// With every session of the user (password change, lockout): see destroyUserSessions.
export async function revokeUserConnections(userId: string, client: Prisma.TransactionClient = db): Promise<void> {
  const now = new Date();
  await client.assistantConnection.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await client.assistantAuthCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
}

// Agency suspended: see setAgencyStatus.
export async function revokeAgencyConnections(agencyId: string, client: Prisma.TransactionClient = db): Promise<void> {
  const now = new Date();
  await client.assistantConnection.updateMany({ where: { agencyId, revokedAt: null }, data: { revokedAt: now } });
  await client.assistantAuthCode.updateMany({ where: { agencyId, usedAt: null }, data: { usedAt: now } });
}

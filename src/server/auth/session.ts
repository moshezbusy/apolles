import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { MAX_RAW_TOKEN_LENGTH as MAX_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";

export const SESSION_COOKIE = "apl_session";
// Sessions end 12 hours after sign-in, with no "remember me" and no sliding renewal.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// What callers get about the signed-in user. Never includes passwordHash or totpSecret.
const userSelect = {
  id: true,
  role: true,
  email: true,
  name: true,
  agencyId: true,
  status: true,
} as const;

const agencySelect = { id: true, name: true, status: true } as const;

export type SessionUser = {
  id: string;
  role: "ADMIN" | "AGENT";
  email: string;
  name: string;
  agencyId: string | null;
  status: "ACTIVE" | "SUSPENDED";
};

export type SessionAgency = { id: string; name: string; status: "ACTIVE" | "SUSPENDED" };

export type SessionContext = {
  sessionId: string;
  user: SessionUser;
  agency?: SessionAgency; // present for AGENT sessions only
};

// Returns the raw token for the cookie. The raw token is never stored or logged.
export async function createSession(userId: string): Promise<string> {
  const rawToken = generateRawToken();
  const createdAt = new Date();
  await db.session.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
    },
  });
  return rawToken;
}

// Checked on every request, so a suspension takes effect at once, not after 12 hours.
export async function getSession(rawToken: string): Promise<SessionContext | null> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { ...userSelect, agency: { select: agencySelect } } },
    },
  });
  if (!row) return null;

  if (Date.now() >= row.expiresAt.getTime()) {
    await db.session.deleteMany({ where: { id: row.id } });
    return null;
  }

  const { agency, ...user } = row.user;
  if (user.status !== "ACTIVE") return null;

  if (user.role === "AGENT") {
    if (!agency || agency.status !== "ACTIVE") return null;
    return { sessionId: row.id, user, agency };
  }
  return { sessionId: row.id, user };
}

// Sign-out: ends only the session that belongs to this token.
export async function destroySession(rawToken: string): Promise<void> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

// Password change or suspension: ends every session of the user. Pass the transaction
// client to make it part of a larger change (e.g. setting a new password).
export async function destroyUserSessions(
  userId: string,
  client: Prisma.TransactionClient = db,
): Promise<void> {
  await client.session.deleteMany({ where: { userId } });
}

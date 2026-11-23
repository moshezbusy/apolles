import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { MAX_RAW_TOKEN_LENGTH as MAX_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";

// The "__Host-" prefix makes the browser itself refuse the cookie unless it is Secure, has
// Path=/ and no Domain: another subdomain, or anything over plain http, can never set or
// replace the session cookie. (Browsers treat http://localhost as secure, so development and
// the browser tests keep working.) Every writer uses sessionCookieOptions below.
export const SESSION_COOKIE = "__Host-apl_session";
// Sessions end 12 hours after sign-in, with no "remember me" and no sliding renewal.
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// The attributes of the session cookie, in one place (the __Host- prefix needs exactly these:
// secure, path "/", and no domain). maxAge 0 clears it.
export function sessionCookieOptions(maxAgeSeconds: number = SESSION_TTL_MS / 1000) {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: maxAgeSeconds } as const;
}

// What callers get about the signed-in user. Never includes passwordHash or totpSecret.
const userSelect = {
  id: true,
  role: true,
  email: true,
  name: true,
  agencyId: true,
  status: true,
  totpConfirmedAt: true,
} as const;

const agencySelect = { id: true, name: true, status: true } as const;

export type SessionUser = {
  id: string;
  role: "ADMIN" | "AGENT";
  email: string;
  name: string;
  agencyId: string | null;
  status: "ACTIVE" | "SUSPENDED";
  totpConfirmedAt: Date | null; // admins: when TOTP was set up; null = not yet (agents: null)
};

export type SessionAgency = { id: string; name: string; status: "ACTIVE" | "SUSPENDED" };

export type SessionContext = {
  sessionId: string;
  user: SessionUser;
  agency?: SessionAgency; // present for AGENT sessions only
  totpVerifiedAt: Date | null; // admin sessions: when the TOTP code was entered; null = not yet
  emailVerifiedAt: Date | null; // agent sessions: when the sign-in code was entered (or a known device)
};

// Returns the raw token for the cookie. The raw token is never stored or logged.
// `verified`: an agent on a known device (or not an agent). Otherwise the session waits for the
// email sign-in code (plan 8e).
export async function createSession(userId: string, opts: { verified: boolean }): Promise<string> {
  const rawToken = generateRawToken();
  const createdAt = new Date();
  await db.session.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      createdAt,
      emailVerifiedAt: opts.verified ? createdAt : null,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
    },
  });
  return rawToken;
}

// Gives a session a new token; the old one stops working at once. Called when the second
// sign-in step succeeds (email code, admin TOTP code): a token that someone saw or planted
// while the session was only half signed in is useless once it is fully signed in. The end of
// the session (12 hours after sign-in) does not move. Returns the raw token for the cookie
// and how long the cookie should live, or null when the session is gone.
export async function rotateSessionToken(sessionId: string): Promise<{ token: string; maxAgeSeconds: number } | null> {
  const token = generateRawToken();
  const now = new Date();
  const rows = await db.session.updateManyAndReturn({
    where: { id: sessionId, expiresAt: { gt: now } },
    data: { tokenHash: hashToken(token) },
    select: { expiresAt: true },
  });
  const row = rows[0];
  if (!row) return null;
  return { token, maxAgeSeconds: Math.max(1, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)) };
}

// Checked on every request, so a suspension takes effect at once, not after 12 hours.
export async function getSession(rawToken: string): Promise<SessionContext | null> {
  if (!rawToken || rawToken.length > MAX_TOKEN_LENGTH) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      expiresAt: true,
      totpVerifiedAt: true,
      emailVerifiedAt: true,
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
    return { sessionId: row.id, user, agency, totpVerifiedAt: row.totpVerifiedAt, emailVerifiedAt: row.emailVerifiedAt };
  }
  return { sessionId: row.id, user, totpVerifiedAt: row.totpVerifiedAt, emailVerifiedAt: row.emailVerifiedAt };
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

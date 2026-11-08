import { generateSecret, generateURI, verify } from "otplib";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import {
  isLocked,
  notLockedAt,
  recordFailedAttempt,
  releaseAttempt,
  reserveAttempt,
} from "@/server/auth/lockout";

// Admin two-step sign-in with an authenticator app: standard TOTP (RFC 6238) with
// SHA-1, 6 digits and a 30-second step, which every authenticator app supports.
// A code from the previous or next step is accepted too (clock drift), and each step's
// code is accepted once only (User.totpLastUsedStep).
// Secrets and codes are never logged.
// Audit: confirming TOTP (admin.totp.confirm) and "Generate a new key" (admin.totp.regenerate)
// each write an audit row in the same transaction as the change. The rows hold only whether
// TOTP is confirmed, never a secret or a code.

const ISSUER = "Apolles";
const PERIOD_SECONDS = 30;
const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation
const CODE_PATTERN = /^\d{6}$/;

// OK          - code accepted
// WRONG       - wrong code (counted toward the lockout), or a code that was already used
// LOCKED      - the account is locked (now or by this attempt); the code was not accepted
// UNAVAILABLE - nothing to check against: no such/expired session, not an active admin,
//               TOTP not in the state this step needs. Not counted.
export type TotpCheckResult = "OK" | "WRONG" | "LOCKED" | "UNAVAILABLE";

type TotpUser = {
  id: string;
  email: string;
  role: "ADMIN" | "AGENT";
  status: "ACTIVE" | "SUSPENDED";
  totpSecret: string | null;
  totpConfirmedAt: Date | null;
  lockedUntil: Date | null;
};

const totpUserSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  totpSecret: true,
  totpConfirmedAt: true,
  lockedUntil: true,
} as const;

// Thrown inside a transaction to roll it back when the session vanished meanwhile.
class SessionGone extends Error {}

// Returns the time step the code belongs to, or null if it matches none in the window.
async function matchStep(secret: string, code: string): Promise<number | null> {
  const result = await verify({
    secret,
    token: code,
    period: PERIOD_SECONDS,
    epochTolerance: PERIOD_SECONDS, // previous, current and next step
  });
  if (!result.valid) return null;
  // The result type also covers HOTP; a valid TOTP result always carries its time step.
  if (!("timeStep" in result)) throw new Error("TOTP verify result without a time step");
  return result.timeStep;
}

async function wrongCode(user: TotpUser, slot: number): Promise<TotpCheckResult> {
  // Same counter as wrong passwords: the reserved slot stays used. A lock also ends every
  // session of the admin.
  const outcome = await recordFailedAttempt(user, slot, { endSessionsOnLock: true });
  return outcome === "LOCKED" ? "LOCKED" : "WRONG";
}

type Claim = {
  user: TotpUser;
  secret: string;
  step: number;
  confirm: boolean; // enrollment: also set totpConfirmedAt
  sessionId?: string; // also mark this session as verified
};

// Uses up the code's time step, in one conditional UPDATE: it matches only while the
// secret is unchanged, TOTP is in the expected state, the account is not locked and no
// code of this step or a later one was used before. Two parallel uses of one code: the
// second UPDATE waits for the first and then no longer matches, so only one succeeds.
// The same transaction resets the failed-attempt counter (which also gives back the slot
// this attempt reserved) and marks the session verified.
async function claimStep({ user, secret, step, confirm, sessionId }: Claim): Promise<TotpCheckResult> {
  try {
    return await db.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.user.updateMany({
        where: {
          id: user.id,
          role: "ADMIN",
          status: "ACTIVE",
          totpSecret: secret,
          totpConfirmedAt: confirm ? null : { not: null },
          AND: [
            notLockedAt(now),
            { OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
          ],
        },
        data: {
          totpLastUsedStep: step,
          failedLogins: 0,
          lockedUntil: null,
          ...(confirm ? { totpConfirmedAt: now } : {}),
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.user.findUnique({
          where: { id: user.id },
          select: { lockedUntil: true },
        });
        return current && isLocked(current.lockedUntil, now.getTime()) ? "LOCKED" : "WRONG";
      }

      if (sessionId !== undefined) {
        const marked = await tx.session.updateMany({
          where: { id: sessionId, userId: user.id, expiresAt: { gt: now } },
          data: { totpVerifiedAt: now },
        });
        if (marked.count !== 1) throw new SessionGone();
      }
      if (confirm) {
        await audit(user.id, "admin.totp.confirm", "User", user.id, { totpConfirmed: false }, { totpConfirmed: true }, tx);
      }
      return "OK";
    });
  } catch (error) {
    if (error instanceof SessionGone) return "UNAVAILABLE";
    throw error;
  }
}

// Shared by confirm and verify: state checks, lock check, attempt slot, code check, then the
// claim.
async function checkCode(
  user: TotpUser | null,
  code: string,
  { confirm, sessionId }: { confirm: boolean; sessionId?: string },
): Promise<TotpCheckResult> {
  if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE" || !user.totpSecret) {
    return "UNAVAILABLE";
  }
  if (confirm !== (user.totpConfirmedAt === null)) return "UNAVAILABLE";
  // While locked, the code is not checked at all and the attempt is not counted.
  if (isLocked(user.lockedUntil)) return "LOCKED";
  // Not 6 digits cannot be a guess of the code: refused without counting.
  if (!CODE_PATTERN.test(code)) return "WRONG";

  // Take an attempt slot BEFORE the code is checked (H1, lockout.ts). No slot left (locked,
  // or the last slots are taken by attempts still in flight) → refused unchecked, so parallel
  // guesses cannot check more than MAX_FAILED_LOGINS codes per lock window.
  const slot = await reserveAttempt(user.id);
  if (slot === null) return "LOCKED";

  const secret = user.totpSecret;
  const step = await matchStep(secret, code);
  if (step === null) return wrongCode(user, slot);
  const result = await claimStep({ user, secret, step, confirm, ...(sessionId !== undefined ? { sessionId } : {}) });
  // The code matched but could not be used: its step was already used (replay), or the TOTP
  // state or the session changed meanwhile. That is not a wrong guess, so the slot is handed
  // back (as before H1, such a refusal does not count). OK already reset the counter in the
  // claim; LOCKED keeps the lock.
  if (result === "WRONG" || result === "UNAVAILABLE") await releaseAttempt(user.id, "RETURN");
  return result;
}

async function findSession(sessionId: string) {
  const row = await db.session.findUnique({
    where: { id: sessionId },
    select: { expiresAt: true, user: { select: totpUserSelect } },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

function otpauthUrlFor(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret, period: PERIOD_SECONDS });
}

// Enrollment, step 1, for an admin who has not confirmed TOTP yet: returns the otpauth://
// URL for the authenticator app. Reuses the stored unconfirmed secret, so reloading the
// setup page keeps the key the admin may already have added; a secret is created only
// when there is none, or when `regenerate` asks for a new one (the old one stops working).
// Throws for anyone else, so a confirmed secret can never be replaced here.
export async function startTotpEnrollment(
  userId: string,
  { regenerate = false }: { regenerate?: boolean } = {},
): Promise<{ otpauthUrl: string }> {
  const read = () =>
    db.user.findUnique({
      where: { id: userId },
      select: { email: true, role: true, totpSecret: true, totpConfirmedAt: true },
    });
  const user = await read();
  if (!user || user.role !== "ADMIN") throw new Error("startTotpEnrollment: not an admin");
  if (user.totpConfirmedAt) throw new Error("startTotpEnrollment: TOTP is already set up");
  if (!regenerate && user.totpSecret) return { otpauthUrl: otpauthUrlFor(user.email, user.totpSecret) };

  const secret = generateSecret({ length: SECRET_BYTES });
  const stored = await db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      // Without `regenerate`, only fill an empty secret: of two parallel first visits, one
      // stores its secret and the other shows that same secret (below).
      where: { id: userId, role: "ADMIN", totpConfirmedAt: null, ...(regenerate ? {} : { totpSecret: null }) },
      data: { totpSecret: secret, totpLastUsedStep: null },
    });
    // Only the "Generate a new key" button is an event; the first key of a first visit is not.
    if (updated.count === 1 && regenerate) {
      await audit(userId, "admin.totp.regenerate", "User", userId, { totpConfirmed: false }, { totpConfirmed: false, newKey: true }, tx);
    }
    return updated;
  });
  if (stored.count === 1) return { otpauthUrl: otpauthUrlFor(user.email, secret) };

  const current = await read();
  if (!regenerate && current && !current.totpConfirmedAt && current.totpSecret) {
    return { otpauthUrl: otpauthUrlFor(current.email, current.totpSecret) };
  }
  throw new Error("startTotpEnrollment: TOTP is already set up");
}

// Enrollment, step 2: the admin proves the app works by entering a code. On success TOTP
// is confirmed and that code's step is used up. A wrong code counts as a failed sign-in.
export async function confirmTotp(userId: string, code: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: totpUserSelect });
  return (await checkCode(user, code, { confirm: true })) === "OK";
}

// Enrollment from the setup page: confirms TOTP and marks this session verified in the
// same transaction, so the confirming code is not needed (and cannot be used) twice.
export async function confirmTotpForSession(
  sessionId: string,
  code: string,
): Promise<TotpCheckResult> {
  const row = await findSession(sessionId);
  return checkCode(row?.user ?? null, code, { confirm: true, sessionId });
}

// Sign-in step 2 for an admin with confirmed TOTP: on a valid, unused code the session is
// marked verified. A wrong code counts as a failed sign-in (3 → locked, sessions ended).
export async function checkTotpForSession(
  sessionId: string,
  code: string,
): Promise<TotpCheckResult> {
  const row = await findSession(sessionId);
  return checkCode(row?.user ?? null, code, { confirm: false, sessionId });
}

export async function verifyTotpForSession(sessionId: string, code: string): Promise<boolean> {
  return (await checkTotpForSession(sessionId, code)) === "OK";
}

// "ABCDEFGH..." → "ABCD EFGH ...", easier to type into an authenticator app.
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? "";
}

// The base32 secret inside an otpauth:// URL (for showing it as text on the setup page).
export function secretFromOtpauthUrl(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get("secret");
  if (!secret) throw new Error("otpauth URL without a secret");
  return secret;
}

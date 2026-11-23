import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { hitRateLimit, refundRateLimit } from "@/server/rate-limit";
import { completeSignIn, recordFailedAttempt, reserveAttempt } from "./lockout";
import { generateRawToken, hashToken } from "./token";

// Plan 8e: an agent signing in on a device Apolles does not know enters a 6-digit code sent by
// email. Nothing about the code or the device token is logged; only hashes are stored.

export const DEVICE_COOKIE = "apl_device";
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODE_SENDS = 3;
const CODE_EMAILS_PER_HOUR = 6; // per user, across sign-ins (no email bombing)

function codeHash(sessionId: string, code: string): string {
  return createHash("sha256").update(`${sessionId}:${code}`).digest("hex");
}

// The device cookie of a browser where this user entered a code, not expired.
export async function isTrustedDevice(userId: string, rawToken: string | undefined, now: Date = new Date()): Promise<boolean> {
  if (!rawToken || rawToken.length > 128) return false;
  const device = await db.trustedDevice.findUnique({ where: { tokenHash: hashToken(rawToken) }, select: { userId: true, expiresAt: true } });
  return !!device && device.userId === userId && device.expiresAt > now;
}

export async function trustDevice(userId: string, now: Date = new Date()): Promise<string> {
  const raw = generateRawToken();
  await db.trustedDevice.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS) } });
  return raw;
}

// A password change forgets every device: the next sign-in everywhere asks for a code.
export async function forgetDevices(userId: string, client: Prisma.TransactionClient = db): Promise<void> {
  await client.trustedDevice.deleteMany({ where: { userId } });
}

// sent         - a new code is on its way
// limited      - this sign-in already got MAX_CODE_SENDS codes (sign in again for more)
// limited-hour - the account got CODE_EMAILS_PER_HOUR code emails this hour
// failed       - the email could not be sent (nothing is counted, no code is left behind)
// gone         - no such session waiting for a code
export type SendResult = "sent" | "limited" | "limited-hour" | "failed" | "gone";

const HOUR_MS = 60 * 60_000;

// A new code for this unverified session, emailed to the user. At most MAX_CODE_SENDS per
// session, checked BEFORE the per-user hourly count, so extra "Resend" clicks on one sign-in
// do not use up the hour's budget of the next sign-in. A mail-provider error is reported as
// "failed", never thrown: the caller shows "try again" instead of crashing mid sign-in.
export async function sendSignInCode(sessionId: string, now: Date = new Date()): Promise<SendResult> {
  const pending = await db.session.findFirst({ where: { id: sessionId, emailVerifiedAt: null }, select: { userId: true, codeSends: true } });
  if (!pending) return "gone";
  if (pending.codeSends >= MAX_CODE_SENDS) return "limited";
  const hourKey = `signin-code:${pending.userId}`;
  if (!(await hitRateLimit(hourKey, CODE_EMAILS_PER_HOUR, HOUR_MS)).allowed) return "limited-hour";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = codeHash(sessionId, code);
  // A new code does not reset the wrong tries of this sign-in. The conditional update is the
  // real per-session cap (two parallel resends cannot both take the last send).
  const claimed = await db.session.updateMany({
    where: { id: sessionId, emailVerifiedAt: null, codeSends: { lt: MAX_CODE_SENDS }, expiresAt: { gt: now } },
    data: { codeHash: hash, codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), codeSends: { increment: 1 } },
  });
  if (claimed.count === 0) {
    await refundRateLimit(hourKey, HOUR_MS); // nothing was sent
    const exists = await db.session.findFirst({ where: { id: sessionId, emailVerifiedAt: null }, select: { id: true } });
    return exists ? "limited" : "gone";
  }
  const session = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { user: { select: { email: true, name: true } } } });
  try {
    await sendEmail({
      to: session.user.email,
      subject: "Your Apolles sign-in code",
      text: `Hello ${session.user.name},\n\nYour Apolles sign-in code is ${code}. It expires in 10 minutes.\n\nIf this was not you, someone knows your password: change it now with "Forgot password" on the sign-in page.\n\nApolles`,
    });
  } catch (error) {
    // The code never reached the user: take it back (it must not stay guessable) and do not
    // count the send, per session or per hour. Logged by name only: no address, no code.
    await db.session.updateMany({ where: { id: sessionId, codeHash: hash }, data: { codeHash: null, codeExpiresAt: null, codeSends: { decrement: 1 } } });
    await refundRateLimit(hourKey, HOUR_MS);
    console.error("sign-in code email failed", { userId: pending.userId, error: error instanceof Error ? error.name : "Error" });
    return "failed";
  }
  return "sent";
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked";

// The code entered on /login/verify. Every wrong code also counts against the account, like a
// wrong password (3 in a row lock it for 15 minutes; the admin is alerted), so signing in again
// never gives fresh guesses. The lock ends only the session that was guessing: whoever is
// guessing codes knows the password but not the mailbox, and must not be able to sign the real
// agent out of the devices where they are working. The 5th wrong code of a session ends it.
export async function verifySignInCode(sessionId: string, code: string, now: Date = new Date()): Promise<VerifyResult> {
  const owner = await db.session.findUnique({ where: { id: sessionId }, select: { user: { select: { id: true, email: true } } } });
  if (!owner) return "locked";
  const user = owner.user;
  // A slot first, as for a password (lockout.ts): parallel guesses cannot check more codes.
  const slot = await reserveAttempt(user.id);
  if (slot === null) {
    await db.session.deleteMany({ where: { id: sessionId } });
    return "locked";
  }
  const result = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
    if (rows.length === 0) return "locked" as const;
    const s = await tx.session.findUniqueOrThrow({ where: { id: sessionId }, select: { codeHash: true, codeExpiresAt: true, codeAttempts: true, emailVerifiedAt: true } });
    if (s.emailVerifiedAt) return "ok" as const;
    if (!s.codeHash || !s.codeExpiresAt || s.codeExpiresAt <= now) return "expired" as const;
    const given = Buffer.from(codeHash(sessionId, /^\d{6}$/.test(code) ? code : "x"), "hex");
    if (!timingSafeEqual(given, Buffer.from(s.codeHash, "hex"))) {
      if (s.codeAttempts + 1 >= MAX_CODE_ATTEMPTS) {
        await tx.session.delete({ where: { id: sessionId } });
        return "locked" as const;
      }
      await tx.session.update({ where: { id: sessionId }, data: { codeAttempts: { increment: 1 } } });
      return "wrong" as const;
    }
    await tx.session.update({ where: { id: sessionId }, data: { emailVerifiedAt: now, codeHash: null, codeExpiresAt: null } });
    return "ok" as const;
  });
  if (result === "ok") {
    // The sign-in is complete: the run of failures is over. A lock set meanwhile wins.
    if (!(await completeSignIn(user.id))) {
      await db.session.deleteMany({ where: { id: sessionId } });
      return "locked";
    }
    return "ok";
  }
  if (result === "expired") {
    // Not a guess: the slot goes back.
    await db.user.updateMany({ where: { id: user.id, failedLogins: { gt: 0 } }, data: { failedLogins: { decrement: 1 } } });
    return "expired";
  }
  const outcome = await recordFailedAttempt(user, slot);
  if (outcome !== "LOCKED") return result;
  await db.session.deleteMany({ where: { id: sessionId, emailVerifiedAt: null } });
  return "locked";
}

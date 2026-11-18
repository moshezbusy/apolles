import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { hitRateLimit } from "@/server/rate-limit";
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

export type SendResult = "sent" | "limited" | "gone";

// A new code for this unverified session, emailed to the user. At most MAX_CODE_SENDS per session.
export async function sendSignInCode(sessionId: string, now: Date = new Date()): Promise<SendResult> {
  const pending = await db.session.findFirst({ where: { id: sessionId, emailVerifiedAt: null }, select: { userId: true } });
  if (!pending) return "gone";
  if (!(await hitRateLimit(`signin-code:${pending.userId}`, CODE_EMAILS_PER_HOUR, 60 * 60_000)).allowed) return "limited";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // A new code does not reset the wrong tries of this sign-in.
  const claimed = await db.session.updateMany({
    where: { id: sessionId, emailVerifiedAt: null, codeSends: { lt: MAX_CODE_SENDS }, expiresAt: { gt: now } },
    data: { codeHash: codeHash(sessionId, code), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS), codeSends: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const exists = await db.session.findFirst({ where: { id: sessionId, emailVerifiedAt: null }, select: { id: true } });
    return exists ? "limited" : "gone";
  }
  const session = await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { user: { select: { email: true, name: true } } } });
  await sendEmail({
    to: session.user.email,
    subject: "Your Apolles sign-in code",
    text: `Hello ${session.user.name},\n\nYour Apolles sign-in code is ${code}. It expires in 10 minutes.\n\nIf this was not you, someone knows your password: change it now with "Forgot password" on the sign-in page.\n\nApolles`,
  });
  return "sent";
}

export type VerifyResult = "ok" | "wrong" | "expired" | "locked";

// The code entered on /login/verify. Every wrong code also counts against the account, like a
// wrong password (3 in a row lock it for 15 minutes and end its sessions; the admin is alerted),
// so signing in again never gives fresh guesses. The 5th wrong code of a session ends it.
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
  const outcome = await recordFailedAttempt(user, slot, { endSessionsOnLock: true });
  return outcome === "LOCKED" ? "locked" : result;
}

import { createHash, randomInt } from "node:crypto";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { isLocked, notLockedAt, recordFailedAttempt, releaseAttempt, reserveAttempt } from "@/server/auth/lockout";
import type { TotpCheckResult } from "@/server/auth/totp";

// Admin 2FA recovery (lost phone). Ten one-time codes, made by the admin once the authenticator
// is set up. Each code is shown once, when the set is made; only a hash is stored. A code
// signs in once, on the admin code page, in place of the authenticator code. Making a new set
// deletes the old one (every unused old code stops working).
// A wrong recovery code counts like a wrong authenticator code (the same second-step counter,
// lockout.ts): 3 in a row lock the second step for 15 minutes and end every session.
// Codes are never logged, and audit rows hold only counts.

export const RECOVERY_CODE_COUNT = 10;
// No 0/O, 1/I/L: easy to read back from paper. 31 symbols × 16 = about 79 bits per code, so a
// plain hash is enough (as for the other random tokens, token.ts).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;

function newCode(): string {
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return raw.match(/.{4}/g)!.join("-");
}

// "abcd efgh-ijkm npqr" → "ABCDEFGHIJKMNPQR"; null when it cannot be a recovery code at all.
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== CODE_LENGTH) return null;
  for (const c of raw) if (!ALPHABET.includes(c)) return null;
  return raw;
}

function codeHash(userId: string, normalized: string): string {
  return createHash("sha256").update(`${userId}:${normalized}`).digest("hex");
}

export class RecoveryCodesNotAllowed extends Error {}

// A new set for an admin whose authenticator is set up: the old set is deleted in the same
// transaction, with one audit row. Returns the codes to show once ("ABCD-EFGH-JKMN-PQRS").
export async function createRecoveryCodes(adminId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
  await db.$transaction(async (tx) => {
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true, status: true, totpConfirmedAt: true } });
    if (!admin || admin.role !== "ADMIN" || admin.status !== "ACTIVE" || !admin.totpConfirmedAt) throw new RecoveryCodesNotAllowed();
    const removed = await tx.totpRecoveryCode.deleteMany({ where: { userId: adminId } });
    await tx.totpRecoveryCode.createMany({
      data: codes.map((code) => ({ userId: adminId, codeHash: codeHash(adminId, normalizeRecoveryCode(code)!) })),
    });
    await audit(adminId, "admin.recovery-codes.create", "User", adminId, { codes: removed.count }, { codes: codes.length }, tx);
  });
  return codes;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  return db.totpRecoveryCode.count({ where: { userId, usedAt: null } });
}

// Thrown inside the transaction to roll the code claim back.
class Refused extends Error {
  readonly result: TotpCheckResult;
  constructor(result: TotpCheckResult) {
    super(result);
    this.result = result;
  }
}

// Sign-in step 2 with a recovery code: on a right, unused code the code is used up and the
// session is verified, in one transaction with the audit rows (the same order as an
// authenticator code: lock check, attempt slot, check, then the claim).
export async function checkRecoveryCodeForSession(sessionId: string, input: string): Promise<TotpCheckResult> {
  const row = await db.session.findUnique({
    where: { id: sessionId },
    select: { expiresAt: true, user: { select: { id: true, email: true, role: true, status: true, totpConfirmedAt: true, lockedUntil: true } } },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return "UNAVAILABLE";
  const user = row.user;
  if (user.role !== "ADMIN" || user.status !== "ACTIVE" || !user.totpConfirmedAt) return "UNAVAILABLE";
  if (isLocked(user.lockedUntil)) return "LOCKED";
  // Not the shape of a recovery code: not a guess of one, refused without counting.
  const normalized = normalizeRecoveryCode(input);
  if (normalized === null) return "WRONG";

  const slot = await reserveAttempt(user.id);
  if (slot === null) return "LOCKED";
  try {
    const result = await db.$transaction(async (tx) => {
      const now = new Date();
      const used = await tx.totpRecoveryCode.updateMany({
        where: { userId: user.id, codeHash: codeHash(user.id, normalized), usedAt: null },
        data: { usedAt: now },
      });
      if (used.count !== 1) return "WRONG" as const;
      // The run of failures is over, only while the second step is not locked (a parallel
      // wrong guess may have locked it meanwhile: then the code stays unused).
      const reset = await tx.user.updateMany({ where: { id: user.id, ...notLockedAt(now) }, data: { failedLogins: 0, lockedUntil: null } });
      if (reset.count !== 1) throw new Refused("LOCKED");
      const marked = await tx.session.updateMany({
        where: { id: sessionId, userId: user.id, expiresAt: { gt: now } },
        data: { totpVerifiedAt: now },
      });
      if (marked.count !== 1) throw new Refused("UNAVAILABLE");
      const left = await tx.totpRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
      await audit(user.id, "user.sign-in", "User", user.id, undefined, { secondStep: "recovery-code" }, tx);
      await audit(user.id, "admin.recovery-code.use", "User", user.id, undefined, { codesLeft: left }, tx);
      return "OK" as const;
    });
    if (result === "OK") return "OK";
    const outcome = await recordFailedAttempt(user, slot, { endSessionsOnLock: true });
    return outcome === "LOCKED" ? "LOCKED" : "WRONG";
  } catch (error) {
    if (error instanceof Refused) {
      // Not a wrong guess: the slot goes back (a lock set meanwhile stays).
      if (error.result === "UNAVAILABLE") await releaseAttempt(user.id, "RETURN");
      return error.result;
    }
    // Fail closed: an error after the slot was taken counts as a wrong code.
    try {
      await recordFailedAttempt(user, slot, { endSessionsOnLock: true });
    } catch (inner) {
      console.error("recovery code attempt not recorded after an error", {
        userId: user.id,
        error: inner instanceof Error ? inner.message : String(inner),
      });
    }
    throw error;
  }
}

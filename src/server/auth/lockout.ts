import { db } from "@/server/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { destroyUserSessions } from "@/server/auth/session";
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";

// One lockout counter per user, shared by every sign-in step: wrong passwords and wrong
// admin TOTP codes both count toward the same MAX_FAILED_LOGINS.

export type FailedAttemptOutcome = "COUNTED" | "LOCKED";

export type RecordFailedAttemptOptions = {
  // End every session of the user when this attempt locks the account (TOTP step: the
  // half-signed-in session that is guessing codes must not survive the lock).
  endSessionsOnLock?: boolean;
};

export function isLocked(lockedUntil: Date | null, now: number = Date.now()): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now;
}

// Prisma filter: the account is not locked at `now`.
export function notLockedAt(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "P2025"
  );
}

// Counts one failed attempt. The increment is one atomic UPDATE that only matches while the
// account is not locked, so parallel attempts cannot skip the limit, and an attempt that
// finishes after another one locked the account is not counted (it gets LOCKED instead).
// The attempt that reaches the limit locks the account, resets the counter and alerts the
// admin; the conditional updateMany makes sure only one attempt does so.
export async function recordFailedAttempt(
  user: { id: string; email: string },
  options: RecordFailedAttemptOptions = {},
): Promise<FailedAttemptOutcome> {
  const now = new Date();
  let failedLogins: number;
  try {
    ({ failedLogins } = await db.user.update({
      where: { id: user.id, ...notLockedAt(now) },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    }));
  } catch (error) {
    if (isRecordNotFound(error)) return "LOCKED"; // locked by a parallel attempt meanwhile
    throw error;
  }
  if (failedLogins < MAX_FAILED_LOGINS) return "COUNTED";

  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
  const locked = await db.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: user.id, failedLogins: { gte: MAX_FAILED_LOGINS } },
      data: { lockedUntil, failedLogins: 0 },
    });
    if (result.count === 1 && options.endSessionsOnLock) {
      await destroyUserSessions(user.id, tx);
    }
    return result.count === 1;
  });
  if (locked) {
    try {
      await notifyAdminLockout({ id: user.id, email: user.email, lockedUntil });
    } catch (error) {
      // The lock is already saved; a mail problem must not undo or hide it.
      console.error("lockout alert failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return "LOCKED";
}

// A correct credential ends the run of failures. Only matches while the account is not
// locked: if parallel wrong guesses locked it meanwhile, the lock stays and this returns
// false (the caller must then refuse the sign-in).
export async function clearFailedAttempts(userId: string): Promise<boolean> {
  const now = new Date();
  const reset = await db.user.updateMany({
    where: { id: userId, ...notLockedAt(now) },
    data: { failedLogins: 0, lockedUntil: null },
  });
  return reset.count === 1;
}

// Is the account unlocked right now (a fresh read, for checks after a slow step)?
// Does not change the counter.
export async function isUnlockedNow(userId: string): Promise<boolean> {
  const now = new Date();
  return (await db.user.count({ where: { id: userId, ...notLockedAt(now) } })) === 1;
}

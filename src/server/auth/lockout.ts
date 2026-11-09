import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { destroyUserSessions } from "@/server/auth/session";
import {
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  STUCK_RESERVATION_MS,
} from "@/server/auth/lockout-policy";

// One lockout counter per user, shared by every sign-in step: wrong passwords and wrong
// admin TOTP codes both count toward the same MAX_FAILED_LOGINS.
//
// Every attempt that checks a secret (password or TOTP code) follows the same order (H1):
//   1. reserveAttempt   - take one attempt slot BEFORE the secret is checked;
//                         no slot left → refuse without checking anything.
//   2. check the secret.
//   3a. wrong → recordFailedAttempt: the slot stays used; the attempt that used the last
//       slot locks the account.
//   3b. right → releaseAttempt: the slot is given back (see SlotRelease).
// So a burst of parallel guesses can never check more than MAX_FAILED_LOGINS secrets per
// lock window: requests beyond the free slots are refused before any check.
// An error between 1 and 3 counts as a wrong secret (login.ts, totp.ts). A request that dies
// there (crash, restart) is healed by the next attempt (see healStuckSlots, R48).

export type FailedAttemptOutcome = "COUNTED" | "LOCKED";

export type RecordFailedAttemptOptions = {
  // End every session of the user when this attempt locks the account (TOTP step: the
  // half-signed-in session that is guessing codes must not survive the lock).
  endSessionsOnLock?: boolean;
};

// How a right secret gives its slot back:
//   RESET  - the run of failures is over (agent password, TOTP code): the counter goes to 0.
//   RETURN - the slot is handed back and nothing else changes (admin password, R36: a correct
//            password neither costs nor clears a strike): the counter goes down by exactly 1,
//            never below 0.
export type SlotRelease = "RESET" | "RETURN";

export function isLocked(lockedUntil: Date | null, now: number = Date.now()): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now;
}

// Prisma filter: the account is not locked at `now`.
export function notLockedAt(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
}

// The database clock as a UTC timestamp(3), like the columns (same as ledger.ts): one clock
// for every app server, so a skewed server cannot make a fresh reservation look old.
const DB_NOW = Prisma.sql`date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')`;

// Step 1. One conditional UPDATE ... RETURNING: adds 1 to failedLogins only while the account
// is not locked and fewer than MAX_FAILED_LOGINS slots are taken, and records when (database
// clock) in attemptReservedAt. Parallel requests queue on the row lock and each one re-checks
// the condition after the one before it committed, so no more than MAX_FAILED_LOGINS slots
// are ever handed out.
// Returns the new count (this attempt's slot number), or null when no slot is free: the
// account is locked, or every slot is taken by attempts still in flight, or the row was
// stuck and has just been locked (healStuckSlots). The caller then refuses as LOCKED without
// checking the secret.
export async function reserveAttempt(userId: string): Promise<number | null> {
  const now = new Date();
  const rows = await db.$queryRaw<{ failedLogins: number }[]>`
    UPDATE "User"
    SET "failedLogins" = "failedLogins" + 1, "attemptReservedAt" = ${DB_NOW}
    WHERE id = ${userId}
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
      AND "failedLogins" < ${MAX_FAILED_LOGINS}
    RETURNING "failedLogins"`;
  const slot = rows[0]?.failedLogins;
  if (slot !== undefined) return slot;
  await healStuckSlots(userId, now);
  return null;
}

// R48. All slots taken, no lock, and the last slot was taken more than STUCK_RESERVATION_MS
// ago (or never recorded): the request holding it died before giving it back, and nothing
// would ever free it. Turn it into a normal timed lock, as if that attempt had been wrong:
// lockedUntil = now + LOCK_DURATION_MS, counter 0, every session of the user ended (on either
// step), one alert. One conditional UPDATE: of parallel requests only one matches. A fresh
// reservation (slot 3 still being checked) does not match and stays as it is.
async function healStuckSlots(userId: string, now: Date): Promise<void> {
  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
  const healed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ email: string }[]>`
      UPDATE "User"
      SET "lockedUntil" = ${lockedUntil}, "failedLogins" = 0
      WHERE id = ${userId}
        AND "failedLogins" >= ${MAX_FAILED_LOGINS}
        AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
        AND ("attemptReservedAt" IS NULL
          OR "attemptReservedAt" < ${DB_NOW} - ${STUCK_RESERVATION_MS}::int * interval '1 millisecond')
      RETURNING email`;
    const row = rows[0];
    if (row) await destroyUserSessions(userId, tx);
    return row;
  });
  if (healed) await alertLockout({ id: userId, email: healed.email }, lockedUntil);
}

// The lock is already saved; a mail problem must not undo or hide it.
async function alertLockout(user: { id: string; email: string }, lockedUntil: Date): Promise<void> {
  try {
    await notifyAdminLockout({ id: user.id, email: user.email, lockedUntil });
  } catch (error) {
    console.error("lockout alert failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 3a. The secret was wrong: the slot reserved for it stays used (`slot` is the count
// reserveAttempt returned). The attempt that took the last slot locks the account, resets
// the counter and alerts the admin; the conditional updateMany makes sure only one attempt
// does so. An attempt that finishes after a parallel one locked the account gets LOCKED.
export async function recordFailedAttempt(
  user: { id: string; email: string },
  slot: number,
  options: RecordFailedAttemptOptions = {},
): Promise<FailedAttemptOutcome> {
  if (slot >= MAX_FAILED_LOGINS) {
    const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    const locked = await db.$transaction(async (tx) => {
      // Not met if a right secret gave a slot back meanwhile: then fewer than
      // MAX_FAILED_LOGINS wrong secrets were checked, and the account must not lock yet.
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
      await alertLockout(user, lockedUntil);
      return "LOCKED";
    }
  }
  // Not this attempt's lock. A parallel attempt may have locked the account meanwhile.
  return (await isUnlockedNow(user.id)) ? "COUNTED" : "LOCKED";
}

// Step 3b. The secret was right: give the slot back (see SlotRelease). Only matches while the
// account is not locked: if parallel wrong guesses locked it meanwhile, the lock stays and
// this returns false (the caller must then refuse the sign-in).
export async function releaseAttempt(userId: string, mode: SlotRelease): Promise<boolean> {
  const now = new Date();
  if (mode === "RESET") {
    const reset = await db.user.updateMany({
      where: { id: userId, ...notLockedAt(now) },
      data: { failedLogins: 0, lockedUntil: null },
    });
    return reset.count === 1;
  }
  const returned = await db.user.updateMany({
    where: { id: userId, ...notLockedAt(now), failedLogins: { gt: 0 } },
    data: { failedLogins: { decrement: 1 } },
  });
  if (returned.count === 1) return true;
  // Counter already 0 (a correct TOTP code reset it meanwhile), or the account is locked.
  return isUnlockedNow(userId);
}

// Is the account unlocked right now (a fresh read, for checks after a slow step)?
// Does not change the counter.
export async function isUnlockedNow(userId: string): Promise<boolean> {
  const now = new Date();
  return (await db.user.count({ where: { id: userId, ...notLockedAt(now) } })) === 1;
}

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ipBucket } from "@/server/client-ip";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { destroyUserSessions } from "@/server/auth/session";
import { hitRateLimit, refundRateLimit } from "@/server/rate-limit";
import { normalizeEmail } from "@/server/users";
import {
  LOCK_ALERT_WINDOW_MS,
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  PASSWORD_POOLS,
  SECOND_STEP_DECAY_MS,
  STUCK_RESERVATION_MS,
  type PasswordWindow,
} from "@/server/auth/lockout-policy";

// Two kinds of counters (lockout-policy.ts):
//
// PASSWORD STEP (login.ts): pools of attempt slots in RateLimitBucket, keyed by the email
// address (a hash of it) and the network, or by the device cookie. Never the user row: a full
// pool refuses more guesses from that network or browser only, so wrong guesses by someone who
// only knows the email never keep the owner from reaching the second step elsewhere.
//
// SECOND STEP (totp.ts, signin-code.ts): one counter per user on the user row, shared by wrong
// admin TOTP codes and wrong agent email codes. Only someone who gave the right password gets
// there. MAX_FAILED_LOGINS wrong codes in a row lock the second step for LOCK_DURATION_MS.
//
// Both follow the same order for every attempt that checks a secret (H1):
//   1. take an attempt slot BEFORE the secret is checked; no slot left → refuse without
//      checking anything.
//   2. check the secret.
//   3a. wrong → the slot stays used.
//   3b. right → the slot is given back.
// So a burst of parallel guesses can never check more secrets than there are slots: requests
// beyond the free slots are refused before any check.
// An error between 1 and 3 counts as a wrong secret (login.ts, totp.ts). A second-step request
// that dies there (crash, restart) is healed by the next attempt (see healStuckSlots, R48); a
// password slot is freed when its window ends.

export type FailedAttemptOutcome = "COUNTED" | "LOCKED";

export type RecordFailedAttemptOptions = {
  // End every session of the user when this attempt locks the account (TOTP step: the
  // half-signed-in session that is guessing codes must not survive the lock).
  endSessionsOnLock?: boolean;
};

// How a right code gives its slot back:
//   RESET  - the run of failures is over (a right TOTP code or email code): the counter goes to 0.
//   RETURN - the slot is handed back and nothing else changes (a code that matched but could not
//            be used, e.g. a replay): the counter goes down by exactly 1, never below 0.
export type SlotRelease = "RESET" | "RETURN";

export function isLocked(lockedUntil: Date | null, now: number = Date.now()): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now;
}

// Prisma filter: the account is not locked at `now`.
export function notLockedAt(now: Date) {
  return { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
}

// ---------------------------------------------------------------------------------------------
// Password step

// Where a password attempt comes from: its network, or a browser this user signed in on before.
export type PasswordClient = { ip: string } | { trustedDeviceToken: string };

export type PoolSlot = { key: string; limit: number; windowMs: number };
// last: this slot filled its pool. retryAfterMs: when that pool's window ends.
export type HeldSlot = PoolSlot & { last: boolean; retryAfterMs: number };

export type PasswordSlots = { ok: true; held: HeldSlot[] } | { ok: false; retryAfterMs: number };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Never the raw email or device token in a key: a sha256 hex digest of it.
function emailId(email: string): string {
  return sha256(normalizeEmail(email));
}

// The window length is part of the key: two windows of one pool can start at the same moment
// (midnight), and RateLimitBucket rows are unique per key and window start.
function poolSlots(prefix: string, windows: readonly PasswordWindow[]): PoolSlot[] {
  return windows.map((window) => ({ key: `${prefix}:${window.windowMs / 60_000}m`, ...window }));
}

function accountPrefix(email: string): string {
  return `signin:pw:acct:${emailId(email)}`;
}

function networkPrefix(email: string): string {
  return `signin:pw:net:${emailId(email)}`;
}

export function passwordPools(email: string, client: PasswordClient): PoolSlot[] {
  if ("trustedDeviceToken" in client) {
    return poolSlots(`signin:pw:dev:${sha256(client.trustedDeviceToken)}`, PASSWORD_POOLS.device);
  }
  return [
    ...poolSlots(`${networkPrefix(email)}:${ipBucket(client.ip)}`, PASSWORD_POOLS.network),
    ...poolSlots(accountPrefix(email), PASSWORD_POOLS.account),
  ];
}

// Step 1 for a password: one slot in every pool, taken one after another, each in one atomic
// statement (hitRateLimit). A pool with no slot left refuses the attempt: the slots this attempt
// already took are given back (no password is checked), and retryAfterMs says when that pool
// frees up. `last` marks a slot that filled its pool (a wrong password there pauses guessing).
export async function takePasswordSlots(pools: PoolSlot[]): Promise<PasswordSlots> {
  const held: HeldSlot[] = [];
  for (const pool of pools) {
    const hit = await hitRateLimit(pool.key, pool.limit, pool.windowMs);
    if (!hit.allowed) {
      await givePasswordSlotsBack([...held, pool]);
      return { ok: false, retryAfterMs: hit.retryAfterMs };
    }
    held.push({ ...pool, last: hit.count === pool.limit, retryAfterMs: hit.retryAfterMs });
  }
  return { ok: true, held };
}

// Step 3b for a password (right password, or refused before the check): every slot is handed
// back, so only wrong passwords add up.
export async function givePasswordSlotsBack(pools: PoolSlot[]): Promise<void> {
  for (const pool of pools) await refundRateLimit(pool.key, pool.windowMs);
}

// Step 3a for a password: the password was wrong; the slots stay used. Paused when this attempt
// filled a pool: the next guess from there is refused until retryAfterMs. For a real account the
// admin is told (at most once an hour per account); unknown addresses are counted the same way
// but alert nobody.
export type WrongPasswordOutcome = { paused: false } | { paused: true; retryAfterMs: number };

export async function recordWrongPassword(
  user: { id: string; email: string } | null,
  held: HeldSlot[],
): Promise<WrongPasswordOutcome> {
  const filled = held.filter((slot) => slot.last);
  if (filled.length === 0) return { paused: false };
  const retryAfterMs = Math.max(...filled.map((slot) => slot.retryAfterMs));
  if (user) await alertLockout(user, new Date(Date.now() + retryAfterMs), "password");
  return { paused: true, retryAfterMs };
}

// A password change (reset link) or the owner's unlock command: the email's password pools on
// every network start empty. Device pools are left (a password change forgets the devices).
// Returns whether any wrong password was still counted.
export async function clearPasswordFailures(email: string, client: Prisma.TransactionClient = db): Promise<boolean> {
  const rows = await client.$queryRaw<{ count: number }[]>`
    DELETE FROM "RateLimitBucket"
    WHERE "key" LIKE ${`${accountPrefix(email)}:%`} OR "key" LIKE ${`${networkPrefix(email)}:%`}
    RETURNING "count"`;
  return rows.some((row) => row.count > 0);
}

// ---------------------------------------------------------------------------------------------
// Alerts

// The lock or pause is already saved; a mail problem must not undo or hide it. At most one alert
// per account per LOCK_ALERT_WINDOW_MS (one atomic count, so parallel locks send one email).
async function alertLockout(
  user: { id: string; email: string },
  lockedUntil: Date,
  step: "password" | "second-step" = "second-step",
): Promise<void> {
  try {
    const { allowed } = await hitRateLimit(`lockout-alert:${user.id}`, 1, LOCK_ALERT_WINDOW_MS);
    if (!allowed) return;
    await notifyAdminLockout({ id: user.id, email: user.email, lockedUntil, step });
  } catch (error) {
    console.error("lockout alert failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Second step

// The database clock as a UTC timestamp(3), like the columns (same as ledger.ts): one clock
// for every app server, so a skewed server cannot make a fresh reservation look old.
const DB_NOW = Prisma.sql`date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')`;

// The last slot was taken more than SECOND_STEP_DECAY_MS ago: nothing is in flight any more
// (a request holds a slot for seconds), and the earlier failures stop counting.
const DECAYED = Prisma.sql`("attemptReservedAt" IS NOT NULL
  AND "attemptReservedAt" < ${DB_NOW} - ${SECOND_STEP_DECAY_MS}::int * interval '1 millisecond')`;

// Step 1. One conditional UPDATE ... RETURNING: adds 1 to failedLogins only while the account
// is not locked and fewer than MAX_FAILED_LOGINS slots are taken, and records when (database
// clock) in attemptReservedAt. Old failures (DECAYED) are dropped first: this attempt then takes
// slot 1. Parallel requests queue on the row lock and each one re-checks the condition after the
// one before it committed, so no more than MAX_FAILED_LOGINS slots are ever handed out.
// Returns the new count (this attempt's slot number), or null when no slot is free: the
// account is locked, or every slot is taken by attempts still in flight, or the row was
// stuck and has just been locked (healStuckSlots). The caller then refuses as LOCKED without
// checking the secret.
export async function reserveAttempt(userId: string): Promise<number | null> {
  const now = new Date();
  const rows = await db.$queryRaw<{ failedLogins: number }[]>`
    UPDATE "User"
    SET "failedLogins" = CASE WHEN ${DECAYED} THEN 1 ELSE "failedLogins" + 1 END,
      "attemptReservedAt" = ${DB_NOW}
    WHERE id = ${userId}
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
      AND ("failedLogins" < ${MAX_FAILED_LOGINS} OR ${DECAYED})
    RETURNING "failedLogins"`;
  const slot = rows[0]?.failedLogins;
  if (slot !== undefined) return slot;
  await healStuckSlots(userId, now);
  return null;
}

// R48. All slots taken, no lock, and the last slot was taken more than STUCK_RESERVATION_MS
// ago (or never recorded): the request holding it died before giving it back, and nothing
// would ever free it. Turn it into a normal timed lock, as if that attempt had been wrong:
// lockedUntil = now + LOCK_DURATION_MS, counter 0, every session of the user ended, one alert.
// One conditional UPDATE: of parallel requests only one matches. A fresh reservation (slot 3
// still being checked) does not match and stays as it is.
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

// Step 3a. The code was wrong: the slot reserved for it stays used (`slot` is the count
// reserveAttempt returned). The attempt that took the last slot locks the second step, resets
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
      // Not met if a right code gave a slot back meanwhile: then fewer than
      // MAX_FAILED_LOGINS wrong codes were checked, and the account must not lock yet.
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

// Step 3b. The code was right, or matched but could not be used: give the slot back (see
// SlotRelease). Only matches while the account is not locked: if parallel wrong guesses locked
// it meanwhile, the lock stays and this returns false (the caller must then refuse).
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
  // Counter already 0 (a correct code reset it meanwhile), or the account is locked.
  return isUnlockedNow(userId);
}

// The whole sign-in is done (agent: right email code): the run of failures is over.
// Only while unlocked: a lock set meanwhile stays. Returns false if the account is locked.
export async function completeSignIn(userId: string): Promise<boolean> {
  const reset = await db.user.updateMany({ where: { id: userId, ...notLockedAt(new Date()) }, data: { failedLogins: 0, lockedUntil: null } });
  return reset.count === 1;
}

// Is the second step unlocked right now (a fresh read, for checks after a slow step)?
// Does not change the counter.
export async function isUnlockedNow(userId: string): Promise<boolean> {
  const now = new Date();
  return (await db.user.count({ where: { id: userId, ...notLockedAt(now) } })) === 1;
}

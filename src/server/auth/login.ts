import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";
import {
  isLocked,
  recordFailedAttempt,
  releaseAttempt,
  reserveAttempt,
} from "@/server/auth/lockout";

export { LOCK_DURATION_MS, MAX_FAILED_LOGINS };

export type LoginFailureReason = "INVALID" | "LOCKED" | "SUSPENDED";

export type LoginResult =
  | { ok: true; userId: string; needsTotp: boolean }
  | { ok: false; reason: LoginFailureReason };

// Exact copy shown on the sign-in page for each failure.
export const LOGIN_ERROR_COPY: Readonly<Record<LoginFailureReason, string>> = {
  INVALID: "Wrong email or password.",
  LOCKED: "Too many attempts. Try again in 15 minutes, or reset your password.",
  SUSPENDED: "This account is suspended. Contact support.",
};

const INVALID = { ok: false, reason: "INVALID" } as const;
const LOCKED = { ok: false, reason: "LOCKED" } as const;
const SUSPENDED = { ok: false, reason: "SUSPENDED" } as const;

export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      passwordHash: true,
      lockedUntil: true,
      agency: { select: { status: true } },
    },
  });

  // Unknown email, or an account that has not set a password yet: spend the same time as a
  // real check and give the same answer as a wrong password.
  if (!user || !user.passwordHash) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    return INVALID;
  }

  // While locked, the password is not checked at all and the attempt is not counted.
  if (isLocked(user.lockedUntil)) return LOCKED;

  // Take an attempt slot BEFORE the (slow) password check (H1, lockout.ts). No slot left
  // (locked, or the last slots are taken by attempts still in flight) → refused unchecked,
  // so parallel guesses cannot check more than MAX_FAILED_LOGINS passwords per lock window.
  const slot = await reserveAttempt(user.id);
  if (slot === null) return LOCKED;

  let stillUnlocked: boolean;
  try {
    if (!(await verifyPassword(user.passwordHash, password))) {
      return (await recordFailedAttempt(user, slot)) === "LOCKED" ? LOCKED : INVALID;
    }
    // The password is right: give the slot back (how and why: below).
    stillUnlocked = await releaseAttempt(user.id, user.role === "ADMIN" ? "RETURN" : "RESET");
  } catch (error) {
    // Fail closed: an error after the slot was taken (argon2, a DB timeout) counts as a failed
    // attempt, so the slot is never left used for good. At the last slot this is a normal
    // 15-minute lock with an alert. No sign-in either way: the error reaches the caller.
    await countFailedAttemptAfterError(user, slot);
    throw error;
  }

  // Giving the slot back only works while unlocked. If parallel wrong guesses locked the account
  // during the password check, this correct guess must not lift the lock or get a session.
  // Agent: the sign-in is complete, so the run of failures is over (counter reset to 0).
  // Admin: the sign-in is only complete after the TOTP code, which shares this counter; a
  // correct password must not reset it, or re-entering the password between wrong codes
  // would allow unlimited code guessing (R36). It only hands its own slot back (counter − 1),
  // so it neither costs nor clears a strike. A correct TOTP code resets it (totp.ts).
  if (!stillUnlocked) return LOCKED;

  // Suspension is only revealed to someone who knows the password.
  const agencyBlocked =
    user.role === "AGENT" && (!user.agency || user.agency.status !== "ACTIVE");
  if (user.status !== "ACTIVE" || agencyBlocked) return SUSPENDED;

  return { ok: true, userId: user.id, needsTotp: user.role === "ADMIN" };
}

// Best effort, after an error: count the attempt; if that fails too, log it (user id and the
// error message only, never the password) and let the caller rethrow the first error.
async function countFailedAttemptAfterError(user: { id: string; email: string }, slot: number): Promise<void> {
  try {
    await recordFailedAttempt(user, slot);
  } catch (error) {
    console.error("sign-in attempt not recorded after an error", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

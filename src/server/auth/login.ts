import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";
import { clearFailedAttempts, isLocked, recordFailedAttempt } from "@/server/auth/lockout";

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

  if (!(await verifyPassword(user.passwordHash, password))) {
    return (await recordFailedAttempt(user)) === "LOCKED" ? LOCKED : INVALID;
  }

  // The password is right: the run of failures is over. If parallel wrong guesses locked
  // the account during the (slow) password check, this correct guess must not lift the
  // lock or get a session.
  if (!(await clearFailedAttempts(user.id))) return LOCKED;

  // Suspension is only revealed to someone who knows the password.
  const agencyBlocked =
    user.role === "AGENT" && (!user.agency || user.agency.status !== "ACTIVE");
  if (user.status !== "ACTIVE" || agencyBlocked) return SUSPENDED;

  return { ok: true, userId: user.id, needsTotp: user.role === "ADMIN" };
}

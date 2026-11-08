import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";

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

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "P2025"
  );
}

// Counts one wrong password. The increment is one atomic UPDATE that only matches while the
// account is not locked, so parallel attempts cannot skip the limit, and an attempt that
// finishes after another one locked the account is not counted (it gets LOCKED instead).
// The attempt that reaches the limit locks the account, resets the counter and alerts the
// admin; the conditional updateMany makes sure only one attempt does so.
async function recordFailure(user: { id: string; email: string }): Promise<LoginResult> {
  const now = new Date();
  let failedLogins: number;
  try {
    ({ failedLogins } = await db.user.update({
      where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    }));
  } catch (error) {
    if (isRecordNotFound(error)) return LOCKED; // locked by a parallel attempt meanwhile
    throw error;
  }
  if (failedLogins < MAX_FAILED_LOGINS) return INVALID;

  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
  const locked = await db.user.updateMany({
    where: { id: user.id, failedLogins: { gte: MAX_FAILED_LOGINS } },
    data: { lockedUntil, failedLogins: 0 },
  });
  if (locked.count === 1) {
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
  return LOCKED;
}

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
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return LOCKED;

  if (!(await verifyPassword(user.passwordHash, password))) return recordFailure(user);

  // The password is right: the run of failures is over. The reset only matches while the
  // account is not locked: if parallel wrong guesses locked it during the (slow) password
  // check, this correct guess must not lift the lock or get a session.
  const now = new Date();
  const reset = await db.user.updateMany({
    where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { failedLogins: 0, lockedUntil: null },
  });
  if (reset.count === 0) return LOCKED;

  // Suspension is only revealed to someone who knows the password.
  const agencyBlocked =
    user.role === "AGENT" && (!user.agency || user.agency.status !== "ACTIVE");
  if (user.status !== "ACTIVE" || agencyBlocked) return SUSPENDED;

  return { ok: true, userId: user.id, needsTotp: user.role === "ADMIN" };
}

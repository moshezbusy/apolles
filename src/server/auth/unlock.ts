import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { normalizeEmail } from "@/server/users";
import { clearPasswordFailures } from "@/server/auth/lockout";

// UNLOCKED   - paused password attempts and/or the second-step lock, failure counter or stuck
//              reservation were cleared
// NOT_LOCKED - the user exists but nothing was locked; nothing was written
// NOT_FOUND  - no user with this email
export type UnlockResult = "UNLOCKED" | "NOT_LOCKED" | "NOT_FOUND";

// Owner command (`pnpm admin:unlock <email>`): clears the sign-in lockout of one account.
// "Locked" means any of: wrong passwords counted for this email on any network (lockout.ts,
// password pools), a second-step lock that has not expired, or failed codes counted (an attempt
// still in flight or stuck always holds a slot, so failedLogins > 0). attemptReservedAt alone
// is NOT a lock: every code attempt writes it and nothing clears it after a success.
// Only the password pools, failedLogins, lockedUntil and attemptReservedAt change: the
// password, TOTP and sessions are left alone. The update is conditional and happens in one
// transaction with its audit row (actor = the unlocked user: the owner has no account here).
export async function unlockUser(email: string): Promise<UnlockResult> {
  const address = normalizeEmail(email);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: address },
      select: { id: true, failedLogins: true, lockedUntil: true },
    });
    if (!user) return "NOT_FOUND";

    const now = new Date();
    const passwordsPaused = await clearPasswordFailures(address, tx, user.id);
    const result = await tx.user.updateMany({
      where: {
        id: user.id,
        OR: [{ lockedUntil: { gt: now } }, { failedLogins: { gt: 0 } }],
      },
      data: { failedLogins: 0, lockedUntil: null, attemptReservedAt: null },
    });
    if (result.count === 0 && !passwordsPaused) return "NOT_LOCKED";

    await audit(
      user.id,
      "user.unlock",
      "User",
      user.id,
      { failedLogins: user.failedLogins, passwordsPaused, locked: user.lockedUntil !== null && user.lockedUntil > now },
      { via: "owner-command" },
      tx,
    );
    return "UNLOCKED";
  });
}

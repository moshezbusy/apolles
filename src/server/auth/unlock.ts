import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { normalizeEmail } from "@/server/users";

// UNLOCKED   - the lock / failure counter / stuck reservation was cleared
// NOT_LOCKED - the user exists but nothing was locked; nothing was written
// NOT_FOUND  - no user with this email
export type UnlockResult = "UNLOCKED" | "NOT_LOCKED" | "NOT_FOUND";

// Owner command (`pnpm admin:unlock <email>`): clears the sign-in lockout of one account.
// "Locked" means either: a lock that has not expired, or failed attempts counted (an attempt
// still in flight or stuck always holds a slot, so failedLogins > 0). attemptReservedAt alone
// is NOT a lock: every sign-in attempt writes it and nothing clears it after a success.
// Only failedLogins, lockedUntil and attemptReservedAt change: the
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
    const result = await tx.user.updateMany({
      where: {
        id: user.id,
        OR: [{ lockedUntil: { gt: now } }, { failedLogins: { gt: 0 } }],
      },
      data: { failedLogins: 0, lockedUntil: null, attemptReservedAt: null },
    });
    if (result.count === 0) return "NOT_LOCKED";

    await audit(
      user.id,
      "user.unlock",
      "User",
      user.id,
      { failedLogins: user.failedLogins, locked: user.lockedUntil !== null && user.lockedUntil > now },
      { via: "owner-command" },
      tx,
    );
    return "UNLOCKED";
  });
}

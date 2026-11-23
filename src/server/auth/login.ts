import { db } from "@/server/db";
import { normalizeEmail } from "@/server/users";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/server/auth/password";
import {
  givePasswordSlotsBack,
  passwordPools,
  recordWrongPassword,
  takePasswordSlots,
} from "@/server/auth/lockout";
import { isTrustedDevice } from "@/server/auth/signin-code";

export type LoginFailureReason = "INVALID" | "LOCKED" | "SUSPENDED";

// ip: the client address (getClientIp). deviceToken: the browser's device cookie, if any (a
// browser where this user finished a sign-in before gets its own attempt pool, lockout.ts).
export type LoginContext = { ip: string; deviceToken?: string | undefined };

export type LoginResult =
  | { ok: true; userId: string; needsTotp: boolean; trustedDevice: boolean }
  | { ok: false; reason: "INVALID" | "SUSPENDED" }
  | { ok: false; reason: "LOCKED"; retryAfterMs: number };

// Exact copy shown on the sign-in page for each failure. LOCKED names the wait (lockedCopy).
// Every account can get out of a paused sign-in with a password reset (it clears the paused
// pools, lockout.ts clearPasswordFailures), admins included.
export const LOGIN_ERROR_COPY: Readonly<Record<LoginFailureReason, string>> = {
  INVALID: "Wrong email or password.",
  LOCKED: "Too many attempts. Try again in 15 minutes, or reset your password with Forgot password.",
  SUSPENDED: "This account is suspended. Contact support.",
};

// "Too many attempts. Try again in 7 minutes, ..." (rounded up; hours from 90 minutes on).
export function lockedCopy(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  const wait =
    minutes >= 90 ? `${Math.ceil(minutes / 60)} hours` : minutes === 1 ? "1 minute" : `${minutes} minutes`;
  return `Too many attempts. Try again in ${wait}, or reset your password with Forgot password.`;
}

export function loginErrorCopy(result: Extract<LoginResult, { ok: false }>): string {
  return result.reason === "LOCKED" ? lockedCopy(result.retryAfterMs) : LOGIN_ERROR_COPY[result.reason];
}

const INVALID = { ok: false, reason: "INVALID" } as const;
const SUSPENDED = { ok: false, reason: "SUSPENDED" } as const;
const locked = (retryAfterMs: number) => ({ ok: false, reason: "LOCKED", retryAfterMs }) as const;

// The password step. An unknown email, an account without a password yet and a real account
// go through the same steps (same pools, same password check time, same answers), so the
// answers do not tell which addresses have an account (lockout-policy.ts).
export async function login(email: string, password: string, context: LoginContext): Promise<LoginResult> {
  const address = normalizeEmail(email);
  const user = await db.user.findUnique({
    where: { email: address },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      passwordHash: true,
      agency: { select: { status: true } },
    },
  });

  // Same lookup for an unknown email (it never matches an empty user id).
  const deviceToken = context.deviceToken;
  const trustedDevice = deviceToken !== undefined && (await isTrustedDevice(user?.id ?? "", deviceToken));

  // Take a slot in every pool BEFORE the (slow) password check (H1, lockout.ts). A full pool
  // refuses unchecked: parallel guesses cannot check more passwords than the pools allow.
  const slots = await takePasswordSlots(
    passwordPools(address, trustedDevice && deviceToken !== undefined ? { trustedDeviceToken: deviceToken } : { ip: context.ip }),
  );
  if (!slots.ok) return locked(slots.retryAfterMs);

  // Unknown email, or an account that has not set a password yet: spend the same time as a real
  // check and give the same answer as a wrong password. An error here (argon2, a DB timeout)
  // reaches the caller and leaves the slots used (fail closed): no sign-in either way.
  const passwordHash = user?.passwordHash ?? null;
  const right = (await verifyPassword(passwordHash ?? DUMMY_PASSWORD_HASH, password)) && passwordHash !== null;
  if (!right || !user) {
    const paused = await recordWrongPassword(user, slots.held);
    return paused.paused ? locked(paused.retryAfterMs) : INVALID;
  }

  // The password is right: its slots are given back, so only wrong passwords add up. The
  // second step (admin TOTP, agent email code on a new device) has its own counter.
  await givePasswordSlotsBack(slots.held);

  // Suspension is only revealed to someone who knows the password.
  const agencyBlocked =
    user.role === "AGENT" && (!user.agency || user.agency.status !== "ACTIVE");
  if (user.status !== "ACTIVE" || agencyBlocked) return SUSPENDED;

  return { ok: true, userId: user.id, needsTotp: user.role === "ADMIN", trustedDevice };
}

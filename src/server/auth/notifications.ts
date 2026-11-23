import { z } from "zod";
import { MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";
import { sendEmail } from "@/server/email/port";

// step: "password" - wrong passwords filled a pool: guessing from that network or browser is
//                    paused (the owner can still sign in elsewhere, or after a password reset);
//       "second-step" - wrong sign-in codes locked the second step (only someone with the right
//                    password gets there).
export type LockedUser = { id: string; email: string; lockedUntil: Date; step?: "password" | "second-step" };

function adminAlertEmail(): string {
  const parsed = z.email().safeParse(process.env.ADMIN_ALERT_EMAIL);
  if (!parsed.success) {
    throw new Error("ADMIN_ALERT_EMAIL is not set to a valid email address");
  }
  return parsed.data;
}

// "2026-11-08 10:15 UTC"
function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Tells the admin that sign-in for an account was paused after failed attempts (at most one such
// email per account per hour, lockout.ts). The message names the account and when the pause ends;
// it never contains a password, code or token.
export async function notifyAdminLockout(user: LockedUser): Promise<void> {
  const to = adminAlertEmail();
  const until = formatUtc(user.lockedUntil);
  const text =
    user.step === "password"
      ? `Repeated wrong passwords were entered for the account ${user.email}.\n` +
        `Guessing from there is paused until ${until} at the latest. The account owner can still sign in from their usual browser or another network.\n` +
        `If this keeps happening, someone may be trying to guess the password.`
      : `The account ${user.email} had ${MAX_FAILED_LOGINS} wrong sign-in codes in a row after a right password.\n` +
        `Its sign-in codes are locked until ${until}.\n` +
        `Someone who knows the password may be trying to sign in. If it was not the account owner, change the password.`;
  await sendEmail({ to, subject: `Apolles: sign-in paused (${user.email})`, text });
}

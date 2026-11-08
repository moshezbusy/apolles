import { z } from "zod";
import { sendEmail } from "@/server/email/port";

export type LockedUser = { id: string; email: string; lockedUntil: Date };

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

// Tells the admin an account was locked after 3 failed sign-ins. The message names the
// account and when it unlocks; it never contains a password or token.
export async function notifyAdminLockout(user: LockedUser): Promise<void> {
  const to = adminAlertEmail();
  await sendEmail({
    to,
    subject: `Apolles: account locked (${user.email})`,
    text:
      `The account ${user.email} was locked after 3 failed sign-in attempts.\n` +
      `It unlocks automatically at ${formatUtc(user.lockedUntil)}.\n` +
      `If this was not the account owner, check for misuse.`,
  });
}

import { z } from "zod";
import type { PasswordTokenPurpose, Role, AccountStatus } from "@/generated/prisma/enums";
import { passwordProblem } from "@/lib/password-rule";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { sendEmail, type EmailMessage } from "@/server/email/port";
import { normalizeEmail } from "@/server/users";
import { hashPassword } from "@/server/auth/password";
import { destroyUserSessions } from "@/server/auth/session";
import { forgetDevices } from "@/server/auth/signin-code";
import { MAX_RAW_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";
import { RATE_LIMITS, emailKey, hitIpRateLimit, hitRateLimit } from "@/server/rate-limit";

// How long a link works (once). A reset link is asked for and used right away: 60 minutes.
// A set-up link (SET) is the invitation a new agent or admin gets, often days after applying
// and not read at once: 72 hours.
export const PASSWORD_TOKEN_TTL_MS: Readonly<Record<PasswordTokenPurpose, number>> = {
  SET: 72 * 60 * 60 * 1000,
  RESET: 60 * 60 * 1000,
};

// INVALID_PASSWORD / INVALID_ADMIN_PASSWORD: the password breaks the rule of an agent / an
// admin (who needs a longer one). COMMON_PASSWORD: it is on the list of most-used passwords.
export type ConsumePasswordTokenResult = "OK" | "EXPIRED" | "INVALID_PASSWORD" | "INVALID_ADMIN_PASSWORD" | "COMMON_PASSWORD";

type AccountState = {
  role: Role;
  status: AccountStatus;
  agency: { status: AccountStatus } | null;
};

const accountSelect = {
  role: true,
  status: true,
  agency: { select: { status: true } },
} as const;

// Same rule as sign-in: the user is active and, for an agent, so is the agency.
function isAccountActive(user: AccountState): boolean {
  if (user.status !== "ACTIVE") return false;
  return user.role !== "AGENT" || user.agency?.status === "ACTIVE";
}

function isPlausibleToken(raw: string): boolean {
  return raw.length > 0 && raw.length <= MAX_RAW_TOKEN_LENGTH;
}

// Creates a new single-use link token and returns the raw value, which goes only into the
// email (never into logs or the database). Every older unused token of the user is
// invalidated in the same transaction, so only the newest link works. The user row is
// locked first, so two links issued at the same moment cannot both stay valid.
export async function issuePasswordToken(
  userId: string,
  purpose: PasswordTokenPurpose,
): Promise<string> {
  const raw = generateRawToken();
  const now = new Date();
  await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (locked.length === 0) throw new Error("issuePasswordToken: user not found");

    await tx.passwordToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.passwordToken.create({
      data: {
        tokenHash: hashToken(raw),
        userId,
        purpose,
        expiresAt: new Date(now.getTime() + PASSWORD_TOKEN_TTL_MS[purpose]),
      },
    });
  });
  return raw;
}

// What the set-password page needs to know about a link. `purpose` is given for a link that
// can no longer be used too (used, expired, suspended account), so the page can say "this
// set-up link has expired" to someone who was invited; it is null only for a link that was
// never issued. Knowing the purpose needs the whole secret link, so it tells nothing about
// who has an account.
// `role` is given only for a usable link: the password rule depends on it (admins need a
// longer password), and the form shows the right rule.
export type PasswordLink = { usable: boolean; purpose: PasswordTokenPurpose | null; role: Role | null };

// Only reads; the token is not consumed.
export async function checkPasswordLink(raw: string): Promise<PasswordLink> {
  if (!isPlausibleToken(raw)) return { usable: false, purpose: null, role: null };
  const row = await db.passwordToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { purpose: true, usedAt: true, expiresAt: true, user: { select: accountSelect } },
  });
  if (!row) return { usable: false, purpose: null, role: null };
  const usable = row.usedAt === null && row.expiresAt.getTime() > Date.now() && isAccountActive(row.user);
  return { usable, purpose: row.purpose, role: usable ? row.user.role : null };
}

// Is this link still usable, and is it a SET or a RESET link? Unknown, used, expired, or
// belonging to a suspended account all look the same (null).
export async function findUsablePasswordToken(raw: string): Promise<PasswordTokenPurpose | null> {
  const link = await checkPasswordLink(raw);
  return link.usable ? link.purpose : null;
}

// Sets a new password through a link. The link is read first (junk or dead links cost nothing
// and say nothing about the password), then the password rule of the account's role is
// checked, so a weak password does not use up the link. The link is then claimed with one
// conditional UPDATE (unused and unexpired) inside the same transaction that saves the
// password, clears any lockout (agents only), ends every session of the user and writes the
// audit row: two parallel submits of one link cannot both succeed, and a failure leaves
// nothing half-done. Afterwards the user is told by email that the password changed.
export async function consumePasswordToken(
  raw: string,
  newPassword: string,
): Promise<ConsumePasswordTokenResult> {
  const link = await checkPasswordLink(raw);
  if (!link.usable || link.role === null) return "EXPIRED";
  const problem = passwordProblem(newPassword, link.role);
  if (problem === "RULE") return link.role === "ADMIN" ? "INVALID_ADMIN_PASSWORD" : "INVALID_PASSWORD";
  if (problem === "COMMON") return "COMMON_PASSWORD";

  // argon2 is slow on purpose: hash before the transaction, not while holding locks.
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashToken(raw);

  const changed = await db.$transaction(async (tx) => {
    // Lock the owner's user row first, in the same order as issuePasswordToken (user, then
    // tokens), so a link issued at the same moment cannot deadlock with this one.
    await tx.$queryRaw`
      SELECT u.id FROM "User" u
      JOIN "PasswordToken" t ON t."userId" = u.id
      WHERE t."tokenHash" = ${tokenHash}
      FOR UPDATE OF u`;

    const now = new Date();
    const claimed = await tx.passwordToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const { userId, user } = await tx.passwordToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true, user: { select: { ...accountSelect, email: true, name: true } } },
    });
    // Suspended since the read above: the link is spent, the password is not changed.
    if (!isAccountActive(user)) return null;
    // The role changed since the read above (never happens today): do not apply the wrong rule.
    if (user.role !== link.role) return null;
    const firstPassword = (await tx.user.count({ where: { id: userId, passwordHash: null } })) === 1;

    // Agents: a new password also clears the lockout. Admins (R36): it does not, because
    // the lockout also counts wrong TOTP codes, and a reset link must not let anyone with
    // the admin's mailbox skip the wait between code guesses.
    await tx.user.update({
      where: { id: userId },
      data:
        user.role === "ADMIN"
          ? { passwordHash }
          : { passwordHash, failedLogins: 0, lockedUntil: null },
    });
    await tx.passwordToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    await destroyUserSessions(userId, tx);
    // Plan 8e: every device is forgotten too; the next sign-in asks for an email code.
    await forgetDevices(userId, tx);
    // The row says that a password was set or changed and how; never the password or the link.
    await audit(userId, firstPassword ? "user.password.set" : "user.password.change", "User", userId, undefined, { via: "link" }, tx);
    return { email: user.email, name: user.name, firstPassword, at: now };
  });
  if (!changed) return "EXPIRED";

  await notifyPasswordChanged(changed);
  return "OK";
}

// "2026-11-08 10:15 UTC"
function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Tells the account owner that the password was set or changed, so a change they did not make
// is noticed at once. Best effort: the password is already saved, and a mail problem must not
// make the change look failed. Logged without the address.
async function notifyPasswordChanged(change: { email: string; name: string; firstPassword: boolean; at: Date }): Promise<void> {
  try {
    const base = appUrl();
    await sendEmail({
      to: change.email,
      subject: change.firstPassword ? "Your Apolles password was set" : "Your Apolles password was changed",
      text:
        `Hello ${change.name},\n\n` +
        `The password of your Apolles account was ${change.firstPassword ? "set" : "changed"} on ${formatUtc(change.at)}. ` +
        `Every device that was signed in was signed out.\n\n` +
        `If this was you, there is nothing to do.\n\n` +
        `If this was not you, choose a new password right away with "Forgot password": ${base}/forgot-password\n`,
    });
  } catch (error) {
    console.error("password-changed email failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL is not set to a valid http(s) URL");
  return parsed.data.replace(/\/+$/, "");
}

// Each email says how long its own link works.
const EXPIRY_LINE: Readonly<Record<PasswordTokenPurpose, string>> = {
  SET: "This link expires in 72 hours and can be used once.",
  RESET: "This link expires in 60 minutes and can be used once.",
};

function passwordEmail(
  purpose: PasswordTokenPurpose,
  user: { email: string; name: string },
  link: string,
): EmailMessage {
  if (purpose === "SET") {
    return {
      to: user.email,
      subject: "Set your Apolles password",
      text:
        `Hello ${user.name},\n\n` +
        `Open this link to set the password for your Apolles account:\n${link}\n\n` +
        `${EXPIRY_LINE.SET}\n\n` +
        `If the link has expired, choose "Forgot password" on the sign-in page to get a new one.\n`,
    };
  }
  return {
    to: user.email,
    subject: "Reset your Apolles password",
    text:
      `Hello ${user.name},\n\n` +
      `Someone asked to reset the password of your Apolles account. ` +
      `Open this link to create a new password:\n${link}\n\n` +
      `${EXPIRY_LINE.RESET}\n\n` +
      `If you did not ask for this, ignore this email. Your password stays the same.\n`,
  };
}

async function sendPasswordEmail(
  user: { id: string; email: string; name: string },
  purpose: PasswordTokenPurpose,
): Promise<void> {
  const base = appUrl(); // fail before a token exists if the link cannot be built
  const raw = await issuePasswordToken(user.id, purpose);
  await sendEmail(passwordEmail(purpose, user, `${base}/set-password/${raw}`));
}

// For new accounts (seed, create agency): emails a SET link. Errors are thrown to the
// caller, who decides what to do (the account exists either way; a new link can be sent).
export async function sendSetPasswordEmail(userId: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  await sendPasswordEmail(user, "SET");
}

// "Forgot password". Always resolves the same way, whether or not the email has an account,
// so the answer does not reveal who has one. A link is emailed only to an active user (of an
// active agency, for agents): a RESET link, or, for an account that never set a password (an
// invitation that expired or got lost), a fresh set-up link with the invitation's lifetime.
// Failures are logged without the email address or link.
export async function requestReset(email: string): Promise<void> {
  let userId: string | undefined;
  try {
    const user = await db.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true, passwordHash: true, ...accountSelect },
    });
    if (!user || !isAccountActive(user)) return;
    userId = user.id;
    await sendPasswordEmail(user, user.passwordHash === null ? "SET" : "RESET");
  } catch (error) {
    console.error("password reset email failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// "Forgot password" with its rate limits: at most RATE_LIMITS.forgot requests per client IP
// and RATE_LIMITS.forgotEmail per email address per window. Over either limit nothing is sent,
// silently: the caller runs this after the response (Next `after()`), so the answer and its
// timing are the same whether or not a limit was hit. The email is counted under a hash,
// never in clear. Errors are logged without the email or the IP.
export async function requestResetWithinLimits(email: string, ip: string): Promise<void> {
  try {
    if (!(await hitIpRateLimit("forgot", ip)).allowed) return;
    const { limit, windowMs } = RATE_LIMITS.forgotEmail;
    if (!(await hitRateLimit(emailKey(email), limit, windowMs)).allowed) return;
  } catch (error) {
    console.error("password reset rate limit check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  await requestReset(email);
}

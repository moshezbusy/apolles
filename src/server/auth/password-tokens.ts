import { z } from "zod";
import type { PasswordTokenPurpose, Role, AccountStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { sendEmail, type EmailMessage } from "@/server/email/port";
import { normalizeEmail } from "@/server/users";
import { hashPassword, isValidPassword } from "@/server/auth/password";
import { destroyUserSessions } from "@/server/auth/session";
import { MAX_RAW_TOKEN_LENGTH, generateRawToken, hashToken } from "@/server/auth/token";

// Set-password and reset links work for 60 minutes, once.
export const PASSWORD_TOKEN_TTL_MS = 60 * 60 * 1000;

export type ConsumePasswordTokenResult = "OK" | "EXPIRED" | "INVALID_PASSWORD";

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
        expiresAt: new Date(now.getTime() + PASSWORD_TOKEN_TTL_MS),
      },
    });
  });
  return raw;
}

// For the set-password page: is this link still usable, and is it a SET or a RESET link?
// Only reads; the token is not consumed. Unknown, used, expired, or belonging to a
// suspended account all look the same (null).
export async function findUsablePasswordToken(raw: string): Promise<PasswordTokenPurpose | null> {
  if (!isPlausibleToken(raw)) return null;
  const row = await db.passwordToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: { purpose: true, usedAt: true, expiresAt: true, user: { select: accountSelect } },
  });
  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) return null;
  if (!isAccountActive(row.user)) return null;
  return row.purpose;
}

// Sets a new password through a link. The password rule is checked first, so a weak
// password does not use up the link. The link is then claimed with one conditional UPDATE
// (unused and unexpired) inside the same transaction that saves the password, clears any
// lockout (agents only) and ends every session of the user: two parallel submits of one
// link cannot both succeed, and a failure leaves nothing half-done.
export async function consumePasswordToken(
  raw: string,
  newPassword: string,
): Promise<ConsumePasswordTokenResult> {
  if (!isValidPassword(newPassword)) return "INVALID_PASSWORD";
  // Cheap read first, so junk or dead links do not cost an argon2 hash.
  if ((await findUsablePasswordToken(raw)) === null) return "EXPIRED";

  // argon2 is slow on purpose: hash before the transaction, not while holding locks.
  const passwordHash = await hashPassword(newPassword);
  const tokenHash = hashToken(raw);

  return db.$transaction(async (tx) => {
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
    if (claimed.count !== 1) return "EXPIRED";

    const { userId, user } = await tx.passwordToken.findUniqueOrThrow({
      where: { tokenHash },
      select: { userId: true, user: { select: accountSelect } },
    });
    // Suspended since the read above: the link is spent, the password is not changed.
    if (!isAccountActive(user)) return "EXPIRED";

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
    return "OK";
  });
}

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL is not set to a valid http(s) URL");
  return parsed.data.replace(/\/+$/, "");
}

const EXPIRY_LINE = "This link expires in 60 minutes and can be used once.";

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
        `${EXPIRY_LINE}\n`,
    };
  }
  return {
    to: user.email,
    subject: "Reset your Apolles password",
    text:
      `Hello ${user.name},\n\n` +
      `Someone asked to reset the password of your Apolles account. ` +
      `Open this link to create a new password:\n${link}\n\n` +
      `${EXPIRY_LINE}\n\n` +
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
// so the answer does not reveal who has one. A RESET link is emailed only to an active user
// (of an active agency, for agents). Failures are logged without the email address or link.
export async function requestReset(email: string): Promise<void> {
  let userId: string | undefined;
  try {
    const user = await db.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true, ...accountSelect },
    });
    if (!user || !isAccountActive(user)) return;
    userId = user.id;
    await sendPasswordEmail(user, "RESET");
  } catch (error) {
    console.error("password reset email failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

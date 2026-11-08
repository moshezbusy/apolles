import { z } from "zod";
import { db } from "@/server/db";
import { createUser, normalizeEmail } from "@/server/users";
import { sendSetPasswordEmail } from "@/server/auth/password-tokens";

// CREATED   - new admin, set-password email sent
// EXISTS    - the admin already exists and has set a password
// PENDING   - the admin exists but has not set a password (and has no TOTP) yet
// NOT_ADMIN - a non-admin user has this email; nothing was created
export type SeedAdminResult = "CREATED" | "EXISTS" | "PENDING" | "NOT_ADMIN";

// What `pnpm db:seed` prints, and its exit code, for each result. Nothing secret.
export function seedAdminReport(result: SeedAdminResult): { message: string; exitCode: 0 | 1 } {
  switch (result) {
    case "CREATED":
      return { message: "Admin created. A set-password email was sent.", exitCode: 0 };
    case "EXISTS":
      return { message: "Admin already exists.", exitCode: 0 };
    case "PENDING":
      return {
        message: "Admin exists but has not set a password. Use Forgot password to get a new link.",
        exitCode: 0,
      };
    case "NOT_ADMIN":
      return {
        message: "A user with this email exists but is not an admin. No admin was created.",
        exitCode: 1,
      };
  }
}

const seedEmail = z.email();

function describeExisting(user: {
  role: "ADMIN" | "AGENT";
  passwordHash: string | null;
  totpConfirmedAt: Date | null;
}): SeedAdminResult {
  if (user.role !== "ADMIN") return "NOT_ADMIN";
  return user.passwordHash === null && user.totpConfirmedAt === null ? "PENDING" : "EXISTS";
}

// Creates the first admin (name "Admin", no password) and emails them a set-password link.
// Safe to run again: if any user already has this email, nothing is created or sent, and
// the result says what state that user is in.
// Prints nothing; the link goes only into the email.
export async function seedAdmin(email: string): Promise<SeedAdminResult> {
  const parsed = seedEmail.safeParse(normalizeEmail(email));
  if (!parsed.success) throw new Error("SEED_ADMIN_EMAIL is not a valid email address");
  const address = parsed.data;

  const existing = await db.user.findUnique({
    where: { email: address },
    select: { role: true, passwordHash: true, totpConfirmedAt: true },
  });
  if (existing) return describeExisting(existing);

  let adminId: string;
  try {
    ({ id: adminId } = await createUser({ email: address, name: "Admin", role: "ADMIN" }));
  } catch (error) {
    // Created by a parallel run between the check and the insert (unique email).
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const raced = await db.user.findUniqueOrThrow({
        where: { email: address },
        select: { role: true, passwordHash: true, totpConfirmedAt: true },
      });
      return describeExisting(raced);
    }
    throw error;
  }
  await sendSetPasswordEmail(adminId);
  return "CREATED";
}

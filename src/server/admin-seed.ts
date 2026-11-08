import { z } from "zod";
import { db } from "@/server/db";
import { createUser, normalizeEmail } from "@/server/users";
import { sendSetPasswordEmail } from "@/server/auth/password-tokens";

export type SeedAdminResult = "CREATED" | "EXISTS";

const seedEmail = z.email();

// Creates the first admin (name "Admin", no password) and emails them a set-password link.
// Safe to run again: if any user already has this email, nothing is created or sent.
// Prints nothing; the link goes only into the email.
export async function seedAdmin(email: string): Promise<SeedAdminResult> {
  const parsed = seedEmail.safeParse(normalizeEmail(email));
  if (!parsed.success) throw new Error("SEED_ADMIN_EMAIL is not a valid email address");
  const address = parsed.data;

  const existing = await db.user.findUnique({ where: { email: address }, select: { id: true } });
  if (existing) return "EXISTS";

  let adminId: string;
  try {
    ({ id: adminId } = await createUser({ email: address, name: "Admin", role: "ADMIN" }));
  } catch (error) {
    // Created by a parallel run between the check and the insert (unique email).
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return "EXISTS";
    }
    throw error;
  }
  await sendSetPasswordEmail(adminId);
  return "CREATED";
}

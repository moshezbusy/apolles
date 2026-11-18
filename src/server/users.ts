import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/server/db";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type CreateUserInput = {
  email: string;
  name: string;
  role: Role;
  agencyId?: string;
  passwordHash?: string;
};

// Minimal creation helper. Pass a transaction client to make it part of a larger change.
// Always stores the normalized email; the unique index on User.email is the backstop. Validation and richer rules arrive with later tasks.
export async function createUser(
  input: CreateUserInput,
  client: Prisma.TransactionClient = db,
) {
  return client.user.create({
    data: {
      email: normalizeEmail(input.email),
      name: input.name,
      role: input.role,
      ...(input.agencyId !== undefined ? { agencyId: input.agencyId } : {}),
      ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
    },
  });
}

// The signed-in agent's own login (screen 20, "Account"): scoped by agency too.
export async function getAccount(userId: string, agencyId: string): Promise<{ name: string; email: string } | null> {
  return db.user.findFirst({ where: { id: userId, agencyId }, select: { name: true, email: true } });
}

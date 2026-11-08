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

// Minimal creation helper. Pass a transaction client to make it part of a larger change. Always stores the normalized email; the unique index on
// User.email is the backstop. Validation and richer rules arrive with later tasks.
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

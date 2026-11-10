import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

// Appends one row to the audit log. Pass the transaction client to write the row in the
// SAME transaction as the change it describes (both happen or neither). `before` / `after`
// must contain only non-secret fields: never passwords, hashes, TOTP secrets or tokens.
export async function audit(
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  before?: Prisma.InputJsonValue,
  after?: Prisma.InputJsonValue,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      actorUserId,
      action,
      targetType,
      targetId,
      ...(before !== undefined ? { before } : {}),
      ...(after !== undefined ? { after } : {}),
    },
  });
}

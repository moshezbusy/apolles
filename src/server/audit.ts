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

// ---------------------------------------------------------------------------------------------
// Reading the log (the admin action log, /admin/audit). The callers check requireAdmin().

const AUDIT_PAGE = 50;
// Never shown, whatever a row holds: rows are written without secrets, and this keeps a mistake
// in a future row from reaching the screen.
const HIDDEN_KEY = /pass|hash|secret|token|otp|cookie|card|iban/i;

// Removes every value whose key looks secret, at any depth.
export function redactAuditValue(value: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, HIDDEN_KEY.test(key) ? "[hidden]" : redactAuditValue(inner ?? null)]));
  }
  return value;
}

export type AuditLogFilters = { action?: string; actorEmail?: string; cursor?: string };

// Newest first (index createdAt, id; by action or actor: their own indexes), a cursor page.
// An actor is chosen by email; an unknown email lists nothing.
export async function listAuditLog(opts: AuditLogFilters) {
  const where: Prisma.AuditLogWhereInput = {};
  const action = opts.action?.trim().slice(0, 100);
  if (action) where.action = action;
  const email = opts.actorEmail?.trim().toLowerCase().slice(0, 254);
  if (email) {
    const actor = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!actor) return { rows: [], nextCursor: null };
    where.actorUserId = actor.id;
  }
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await db.auditLog.findUnique({ where: { id: opts.cursor }, select: { id: true } }) : null;
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_PAGE + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    select: { id: true, action: true, targetType: true, targetId: true, before: true, after: true, createdAt: true, actor: { select: { email: true, role: true } } },
  });
  const page = rows.slice(0, AUDIT_PAGE).map((row) => ({ ...row, before: redactAuditValue(row.before), after: redactAuditValue(row.after) }));
  return { rows: page, nextCursor: rows.length > AUDIT_PAGE ? (rows[AUDIT_PAGE - 1]?.id ?? null) : null };
}

// The actions that appear in the log, for the filter (one row per action name).
export async function auditActions(): Promise<string[]> {
  const rows = await db.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" }, take: 200 });
  return rows.map((row) => row.action);
}

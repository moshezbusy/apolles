import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { AccountStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { sendSetPasswordEmail } from "@/server/auth/password-tokens";
import { createUser, normalizeEmail } from "@/server/users";
import { getBalances } from "@/server/wallet/ledger";

// Admin-only services. The caller (a server action) has already run requireAdmin() and
// passes the admin's user id as `actor`; every change here is audited in the same
// transaction as the change itself.

export const DUPLICATE_EMAIL_MESSAGE = "A user with this email already exists";

export const createAgencyInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    country: z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{2}$/)), // ISO 3166-1 alpha-2, normalized to uppercase
    agentName: z.string().trim().min(1).max(100),
    agentEmail: z.string().trim().max(254).pipe(z.email()),
  })
  .strict();

export type CreateAgencyInput = z.input<typeof createAgencyInput>;

export class AgencyNotFoundError extends Error {
  constructor() {
    super("Agency not found");
    this.name = "AgencyNotFoundError";
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Only a clash on User.email counts as "email already exists". With the driver adapter the
// constraint name is in meta.driverAdapterError.cause.constraint.index ("User_email_key");
// meta.target (array of fields) is checked as well for other client setups.
function isDuplicateUserEmail(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as
    | {
        modelName?: unknown;
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (typeof constraint?.index === "string") return constraint.index === "User_email_key";
  if (Array.isArray(constraint?.fields)) return constraint.fields.includes("email");
  if (Array.isArray(meta?.target)) return meta.target.includes("email");
  if (typeof meta?.target === "string") return meta.target.includes("email");
  return false;
}

// One transaction: agency (with a temporary reference), its final bank reference built from
// the sequence number, the AGENT user (no password yet) and the audit row. A duplicate
// email rolls everything back. The SET-password email goes out after the commit; if it
// fails the agency stays and `emailSent` is false (a new link can be requested through
// "Forgot password").
export async function createAgency(
  actor: string,
  rawInput: CreateAgencyInput,
): Promise<{ agencyId: string; userId: string; emailSent: boolean }> {
  const input = createAgencyInput.parse(rawInput);
  const agentEmail = normalizeEmail(input.agentEmail);

  let created: { agencyId: string; userId: string };
  try {
    created = await db.$transaction(async (tx) => {
      const pending = await tx.agency.create({
        data: {
          name: input.name,
          country: input.country,
          bankReference: `pending-${crypto.randomUUID()}`,
        },
      });
      const bankReference = `APL-${String(pending.bankRefNo).padStart(4, "0")}`;
      const agency = await tx.agency.update({
        where: { id: pending.id },
        data: { bankReference },
      });
      const user = await createUser(
        { email: agentEmail, name: input.agentName, role: "AGENT", agencyId: agency.id },
        tx,
      );
      await audit(
        actor,
        "agency.create",
        "Agency",
        agency.id,
        undefined,
        {
          name: agency.name,
          country: agency.country,
          bankReference: agency.bankReference,
          status: agency.status,
          agentUserId: user.id,
        },
        tx,
      );
      return { agencyId: agency.id, userId: user.id };
    });
  } catch (error) {
    if (isDuplicateUserEmail(error)) throw new Error(DUPLICATE_EMAIL_MESSAGE);
    throw error;
  }

  let emailSent = true;
  try {
    await sendSetPasswordEmail(created.userId);
  } catch (error) {
    emailSent = false;
    // No email address or link in the log.
    console.error("agency created but set-password email failed", {
      agencyId: created.agencyId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ...created, emailSent };
}

// Suspends or reactivates an agency. The agency row is locked, so "before" is the real
// previous status. Same status again: nothing is written and no audit row is added.
// Suspending also ends every session of the agency's users, in the same transaction.
export async function setAgencyStatus(
  actor: string,
  agencyId: string,
  status: AccountStatus,
): Promise<{ changed: boolean }> {
  if (status !== "ACTIVE" && status !== "SUSPENDED") throw new Error("Invalid status");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: AccountStatus }[]>`
      SELECT "status" FROM "Agency" WHERE id = ${agencyId} FOR UPDATE`;
    const current = rows[0];
    if (!current) throw new AgencyNotFoundError();
    if (current.status === status) return { changed: false };

    await tx.agency.update({ where: { id: agencyId }, data: { status } });
    if (status === "SUSPENDED") {
      await tx.session.deleteMany({ where: { user: { agencyId } } });
    }
    await audit(
      actor,
      status === "SUSPENDED" ? "agency.suspend" : "agency.reactivate",
      "Agency",
      agencyId,
      { status: current.status },
      { status },
      tx,
    );
    return { changed: true };
  });
}

export type AgencyListItem = {
  id: string;
  name: string;
  country: string;
  bankReference: string;
  status: AccountStatus;
  createdAt: Date;
  agentEmail: string | null;
  balanceCents: number;
  heldCents: number;
};

// Newest first (createdAt desc, id desc). `cursor` is the id of the last agency of the
// previous page. Balances for the whole page come from one grouped query.
export async function listAgencies(
  cursor?: string,
  take = DEFAULT_PAGE_SIZE,
): Promise<{ agencies: AgencyListItem[]; nextCursor: string | null }> {
  const size = Number.isFinite(take)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(take)))
    : DEFAULT_PAGE_SIZE;
  let where: Prisma.AgencyWhereInput = {};
  if (cursor !== undefined) {
    const after = await db.agency.findUnique({
      where: { id: cursor },
      select: { id: true, createdAt: true },
    });
    if (!after) throw new Error("Invalid cursor");
    where = {
      OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ],
    };
  }
  const rows = await db.agency.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
    select: {
      id: true,
      name: true,
      country: true,
      bankReference: true,
      status: true,
      createdAt: true,
      users: {
        where: { role: "AGENT" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { email: true },
      },
    },
  });
  const hasMore = rows.length > size;
  const page = hasMore ? rows.slice(0, size) : rows;
  const balances = await getBalances(page.map((a) => a.id));
  const agencies = page.map(({ users, ...agency }) => ({
    ...agency,
    agentEmail: users[0]?.email ?? null,
    balanceCents: balances.get(agency.id)?.balanceCents ?? 0,
    heldCents: balances.get(agency.id)?.heldCents ?? 0,
  }));
  const last = agencies[agencies.length - 1];
  return { agencies, nextCursor: hasMore && last ? last.id : null };
}

// For the confirm page.
export async function getAgencySummary(
  agencyId: string,
): Promise<{ id: string; name: string; status: AccountStatus } | null> {
  return db.agency.findUnique({
    where: { id: agencyId },
    select: { id: true, name: true, status: true },
  });
}

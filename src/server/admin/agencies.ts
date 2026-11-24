import { z } from "zod";
import { isCountryCode } from "@/lib/countries";
import { Prisma } from "@/generated/prisma/client";
import type { AccountStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { revokeAgencyAssistants } from "@/server/assistant/connections";
import { sendSetPasswordEmail } from "@/server/auth/password-tokens";
import { hitRateLimit } from "@/server/rate-limit";
import { createUser, normalizeEmail } from "@/server/users";
import { getBalances } from "@/server/wallet/ledger";

// Admin-only services. The caller (a server action) has already run requireAdmin() and
// passes the admin's user id as `actor`; every change here is audited in the same
// transaction as the change itself.

export const DUPLICATE_EMAIL_MESSAGE = "A user with this email already exists";

export const createAgencyInput = z
  .object({
    name: z.string().trim().min(2).max(100),
    // ISO 3166-1 alpha-2, normalized to uppercase; only officially assigned codes (no UK, EU).
    country: z.string().trim().toUpperCase().refine(isCountryCode),
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
export function isDuplicateUserEmail(error: unknown): boolean {
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

// The rows of a new agency, inside the caller's transaction: the agency (with a temporary
// reference), its final bank reference built from the sequence number, the AGENT user (no
// password yet) and the audit row. A duplicate email fails the transaction (the caller tells
// it apart with isDuplicateUserEmail).
export async function createAgencyRows(
  tx: Prisma.TransactionClient,
  actor: string,
  input: z.output<typeof createAgencyInput>,
): Promise<{ agencyId: string; userId: string }> {
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
    { email: normalizeEmail(input.agentEmail), name: input.agentName, role: "AGENT", agencyId: agency.id },
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
}

// The SET-password email of a new agency's agent, after the commit. If it fails the agency
// stays and the answer is false (the admin sends it again from the agency's page,
// resendSetupEmail below; "Forgot password" also sends a fresh set-up link).
export async function sendAgencyInvitation(created: { agencyId: string; userId: string }): Promise<boolean> {
  try {
    await sendSetPasswordEmail(created.userId);
    return true;
  } catch (error) {
    // No email address or link in the log.
    console.error("agency created but set-password email failed", {
      agencyId: created.agencyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// One transaction for the rows (createAgencyRows); a duplicate email rolls everything back.
// The SET-password email goes out after the commit (sendAgencyInvitation).
export async function createAgency(
  actor: string,
  rawInput: CreateAgencyInput,
): Promise<{ agencyId: string; userId: string; emailSent: boolean }> {
  const input = createAgencyInput.parse(rawInput);

  let created: { agencyId: string; userId: string };
  try {
    created = await db.$transaction((tx) => createAgencyRows(tx, actor, input));
  } catch (error) {
    if (isDuplicateUserEmail(error)) throw new Error(DUPLICATE_EMAIL_MESSAGE);
    throw error;
  }
  return { ...created, emailSent: await sendAgencyInvitation(created) };
}

// Suspends or reactivates an agency. The agency row is locked, so "before" is the real
// previous status. Same status again: nothing is written and no audit row is added.
// Suspending also ends every session of the agency's users, and revokes their AI assistants,
// in the same transaction.
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
      // Plan 8e: and every remembered device, so a reactivation asks for a sign-in code again.
      await tx.trustedDevice.deleteMany({ where: { user: { agencyId } } });
      // And every connected AI assistant, for good: a reactivation does not reconnect them.
      await revokeAgencyAssistants(agencyId, actor, tx);
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
  // The agent was invited and has not set a password yet ("Invited, not signed in yet").
  agentInvited: boolean;
  balanceCents: number;
  heldCents: number;
};

export type AgencyFilters = {
  // Part of the agency's name, its business email, or the email of one of its users.
  q?: string;
  status?: AccountStatus;
};

// Newest first (createdAt desc, id desc). `cursor` is the id of the last agency of the
// previous page. Balances for the whole page come from one grouped query.
export async function listAgencies(
  cursor?: string,
  take = DEFAULT_PAGE_SIZE,
  filters: AgencyFilters = {},
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
  const and: Prisma.AgencyWhereInput[] = [where];
  if (filters.status) and.push({ status: filters.status });
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const term = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { users: { some: { email: { contains: term.toLowerCase() } } } },
      ],
    });
  }
  const rows = await db.agency.findMany({
    where: { AND: and },
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
  const ids = page.map((a) => a.id);
  // One query for the whole page (never the hashes themselves): agencies with an agent who
  // has no password yet.
  const [balances, invited] = await Promise.all([
    getBalances(ids),
    db.user.findMany({ where: { agencyId: { in: ids }, role: "AGENT", passwordHash: null }, select: { agencyId: true } }),
  ]);
  const invitedAgencies = new Set(invited.map((u) => u.agencyId));
  const agencies = page.map(({ users, ...agency }) => ({
    ...agency,
    agentEmail: users[0]?.email ?? null,
    agentInvited: invitedAgencies.has(agency.id),
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

// For the admin's agency page: the agency's agent and whether they still have to set a
// password (the invitation is pending). Null when the agency has no agent.
export async function getAgencyInvitation(agencyId: string): Promise<{ agentEmail: string; pending: boolean } | null> {
  if (typeof agencyId !== "string" || agencyId.length > 100) return null;
  const pending = await db.user.findFirst({ where: { agencyId, role: "AGENT", passwordHash: null }, orderBy: { createdAt: "asc" }, select: { email: true } });
  if (pending) return { agentEmail: pending.email, pending: true };
  const agent = await db.user.findFirst({ where: { agencyId, role: "AGENT" }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return agent ? { agentEmail: agent.email, pending: false } : null;
}

export type ResendSetupResult = "SENT" | "ALREADY_SET" | "SUSPENDED" | "NOT_FOUND" | "LIMITED" | "FAILED";

const SETUP_EMAIL_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

// "Send the set-up email again" (admin): a fresh invitation link for the agency's agent who
// has not set a password yet. The older link stops working (issuePasswordToken). Never for an
// account that already has a password (that is "Forgot password", asked by the agent), and
// not while the agency or the agent is suspended (the link would not work). Limited per
// agency, and audited whether or not the email went out; the row never holds the address or
// the link.
export async function resendSetupEmail(actor: string, agencyId: string): Promise<ResendSetupResult> {
  if (typeof agencyId !== "string" || agencyId.length === 0 || agencyId.length > 100) return "NOT_FOUND";
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      status: true,
      users: { where: { role: "AGENT", passwordHash: null }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, status: true } },
    },
  });
  if (!agency) return "NOT_FOUND";
  const agent = agency.users[0];
  if (!agent) return "ALREADY_SET";
  if (agency.status !== "ACTIVE" || agent.status !== "ACTIVE") return "SUSPENDED";
  if (!(await hitRateLimit(`setup-email:agency:${agencyId}`, SETUP_EMAIL_LIMIT.limit, SETUP_EMAIL_LIMIT.windowMs)).allowed) return "LIMITED";

  let emailSent = true;
  try {
    await sendSetPasswordEmail(agent.id);
  } catch (error) {
    emailSent = false;
    // No email address or link in the log.
    console.error("set-up email could not be sent again", { agencyId, error: error instanceof Error ? error.message : String(error) });
  }
  await audit(actor, "agency.setup-email.resend", "Agency", agencyId, undefined, { agentUserId: agent.id, emailSent });
  return emailSent ? "SENT" : "FAILED";
}

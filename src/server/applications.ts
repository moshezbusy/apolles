import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApplicationStatus, Prisma } from "@/generated/prisma/client";
import { isCountryCode } from "@/lib/countries";
import { createAgencyInput, createAgencyRows, isDuplicateUserEmail, sendAgencyInvitation } from "@/server/admin/agencies";
import { audit } from "@/server/audit";
import { ipBucket } from "@/server/client-ip";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { hitRateLimit } from "@/server/rate-limit";
import { normalizeEmail } from "@/server/users";

// "Join Apolles" (screen 02, plan 7) and the admin's review of applications. Public input is
// checked here (Zod strict, no control characters) and limited per IP and per email. Logs and
// audit rows never hold the applicant's details.

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v));

export const applicationInput = z
  .object({
    agencyName: text(2, 100),
    contactName: text(1, 100),
    email: z.string().trim().max(254).pipe(z.email()),
    phone: z
      .string()
      .trim()
      .max(30)
      .regex(/^\+?[0-9 \-()]+$/)
      .refine((v) => {
        const digits = v.replace(/\D/g, "").length;
        return digits >= 7 && digits <= 15;
      }),
    country: z.string().trim().toUpperCase().refine(isCountryCode),
    website: text(3, 200),
    license: text(0, 100),
    notes: z
      .string()
      .transform((v) => v.replace(/\r\n?/g, "\n"))
      .pipe(z.string().trim().max(1000).refine((v) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(v))),
    terms: z.literal("on"),
    // Hidden from people; a bot that fills it gets the normal answer and nothing is saved.
    company: z.string().max(200),
  })
  .strict();

export type ApplicationInput = z.input<typeof applicationInput>;
export type SubmitResult = { ok: true } | { ok: false; error: "invalid" | "limited" };

const IP_LIMIT = { limit: 5, windowMs: 60 * 60_000 };
const EMAIL_LIMIT = { limit: 3, windowMs: 24 * 60 * 60_000 };

function emailKey(email: string): string {
  return `join:email:${createHash("sha256").update(email).digest("hex").slice(0, 32)}`;
}

function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  return parsed.success ? parsed.data.replace(/\/$/, "") : "";
}

// Overall caps, whatever the network. Over ALL_LIMIT applications an hour the form stays open
// (one flood must not close it for everyone): the application is still saved, but no email at
// all goes out for it, so the form can never be used to send mail to many addresses. Admin
// alerts: one per 10 minutes is enough to know there is something to review.
const ALL_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const ALERT_LIMIT = { limit: 1, windowMs: 10 * 60_000 };

// How the emails of an application are run. The join action passes Next's `after()`, so they
// go out once the answer has been sent; the default runs them at once (tests, scripts).
export type RunLater = (work: () => Promise<void>) => unknown;
const runNow: RunLater = (work) => work();

// The answer is the same whether or not the email already has a login or an application, so the
// form never tells who is a user. An existing user gets a short note by email instead. No text the
// applicant typed is ever put in an email. The emails are not part of the answer: they run
// through `runLater`, so neither the reply nor how long it takes shows which case it was.
export async function submitApplication(raw: ApplicationInput | Record<string, string>, ip: string, runLater: RunLater = runNow): Promise<SubmitResult> {
  const parsed = applicationInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (v.company !== "") return { ok: true };
  // IPv6 counts per /64 (one home or office network), IPv4 per address (ipBucket).
  if (!(await hitRateLimit(`join:ip:${ipBucket(ip)}`, IP_LIMIT.limit, IP_LIMIT.windowMs)).allowed) return { ok: false, error: "limited" };
  const email = normalizeEmail(v.email);
  if (!(await hitRateLimit(emailKey(email), EMAIL_LIMIT.limit, EMAIL_LIMIT.windowMs)).allowed) return { ok: false, error: "limited" };
  const quiet = !(await hitRateLimit("join:all", ALL_LIMIT.limit, ALL_LIMIT.windowMs)).allowed;

  const outcome = await db.$transaction(async (tx) => {
    // One at a time per email (approve takes the same lock), so two quick posts make one application.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`join:${email}`}))`;
    const [user, open] = await Promise.all([
      tx.user.findUnique({ where: { email }, select: { id: true } }),
      // Pending, or approved and still being opened: either way not a second application.
      tx.agencyApplication.findFirst({ where: { email, OR: [{ status: "PENDING" }, { status: "APPROVED", agencyId: null }] }, select: { id: true } }),
    ]);
    if (user) return "user" as const;
    if (open) return "open" as const;
    await tx.agencyApplication.create({
      data: { agencyName: v.agencyName, contactName: v.contactName, email, phone: v.phone, country: v.country, website: v.website, license: v.license, notes: v.notes },
    });
    return "saved" as const;
  });

  if (!quiet && outcome !== "open") await runLater(() => sendApplicationEmails(outcome, email));
  return { ok: true };
}

// Best effort, after the answer: nothing here changes it (failures are logged by name only).
async function sendApplicationEmails(outcome: "user" | "saved", email: string): Promise<void> {
  const base = appUrl();
  const fail = (what: string) => (error: unknown) => console.error("join email failed", { what, error: error instanceof Error ? error.name : "Error" });
  if (outcome === "user") {
    await sendEmail({
      to: email,
      subject: "You already have an Apolles account",
      text: `Hello,\n\nSomeone asked to join Apolles with this email address, which already has an account. To sign in, go to ${base}/login. If you forgot your password, choose "Forgot password" there.\n\nIf this was not you, you can ignore this email.\n\nApolles`,
    }).catch(fail("join existing-account email"));
    return;
  }
  await sendEmail({
    to: email,
    subject: "Your Apolles application was received",
    text: "Hello,\n\nThanks for applying to Apolles. We will review your agency details, usually within 2 to 3 business days.\n\nOnce approved, you get an email with a link to set your password and sign in. The link works for 72 hours. If we need more details, we will email you.\n\nIf you did not apply, you can ignore this email.\n\nApolles",
  }).catch(fail("application email"));
  try {
    const admin = z.email().safeParse(process.env.ADMIN_ALERT_EMAIL);
    if (admin.success && (await hitRateLimit("join:alert", ALERT_LIMIT.limit, ALERT_LIMIT.windowMs)).allowed) {
      await sendEmail({
        to: admin.data,
        subject: "New Apolles agency application",
        text: `New agency applications are waiting for review.\n\n${base}/admin/applications`,
      });
    }
  } catch (error) {
    fail("application alert")(error);
  }
}

const SELECT = {
  id: true,
  status: true,
  agencyName: true,
  contactName: true,
  email: true,
  phone: true,
  country: true,
  website: true,
  license: true,
  notes: true,
  createdAt: true,
  reviewedAt: true,
  agencyId: true,
} satisfies Prisma.AgencyApplicationSelect;

export type ApplicationRow = Prisma.AgencyApplicationGetPayload<{ select: typeof SELECT }>;

const PAGE = 50;

export async function listApplications(opts: { status?: ApplicationStatus; cursor?: string; take?: number } = {}): Promise<{ rows: ApplicationRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(1, Math.trunc(opts.take ?? PAGE)), 100);
  const where: Prisma.AgencyApplicationWhereInput = opts.status ? { status: opts.status } : {};
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await db.agencyApplication.findFirst({ where: { ...where, id: opts.cursor }, select: { id: true } }) : null;
  const rows = await db.agencyApplication.findMany({
    where,
    select: SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
  });
  return { rows: rows.slice(0, take), nextCursor: rows.length > take ? (rows[take - 1]?.id ?? null) : null };
}

export async function getApplication(id: string): Promise<ApplicationRow | null> {
  if (typeof id !== "string" || id.length > 64) return null;
  return db.agencyApplication.findUnique({ where: { id }, select: SELECT });
}

export type ReviewResult = { ok: true; agencyId?: string; emailSent?: boolean } | { ok: false; error: string };

const NOT_PENDING = "This application was already reviewed.";
const DUPLICATE_USER = "A user with this email already exists.";

// Thrown inside the approval transaction to roll it back with a plain answer.
class ApprovalRefused extends Error {}

// Approve, in ONE transaction: the application is claimed (Pending → Approved, one click only),
// the agency and its agent user are made as with "New agency", and the application is linked to
// the agency. Either all of it happens or none: a crash or an error in the middle leaves the
// application pending, never "approved with no agency". The set-password email goes out after
// the commit.
// An application that an older version left Approved with no agency is completed the same
// way: approving it again opens the agency, or, when its agent already exists (the agency was
// opened and only the link failed), links that agency and makes nothing new.
export async function approveApplication(actor: string, id: string): Promise<ReviewResult> {
  const app = await getApplication(id);
  if (!app) return { ok: false, error: "This application was not found." };
  const input = createAgencyInput.safeParse({ name: app.agencyName, country: app.country, agentName: app.contactName, agentEmail: app.email });
  if (!input.success) return { ok: false, error: "This application's details are not valid for an agency. Reject it and ask the agency to apply again." };

  let outcome: { agencyId: string; created: { agencyId: string; userId: string } | null };
  try {
    outcome = await db.$transaction(async (tx) => {
      // Under the same per-email lock as the join form: no new application can slip in meanwhile.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`join:${app.email}`}))`;
      const claimed = await tx.agencyApplication.updateMany({
        where: { id: app.id, OR: [{ status: "PENDING" }, { status: "APPROVED", agencyId: null }] },
        data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: actor },
      });
      if (claimed.count === 0) throw new ApprovalRefused(NOT_PENDING);

      // Only for an application that was already Approved: its agent may exist from the first try.
      const existing = app.status === "APPROVED" ? await tx.user.findUnique({ where: { email: app.email }, select: { role: true, agencyId: true } }) : null;
      if (existing) {
        if (existing.role !== "AGENT" || !existing.agencyId) throw new ApprovalRefused(DUPLICATE_USER);
        await tx.agencyApplication.update({ where: { id: app.id }, data: { agencyId: existing.agencyId } });
        await audit(actor, "application.approve", "AgencyApplication", app.id, undefined, { agencyId: existing.agencyId, linkedExisting: true }, tx);
        return { agencyId: existing.agencyId, created: null };
      }

      const created = await createAgencyRows(tx, actor, input.data);
      await tx.agency.update({ where: { id: created.agencyId }, data: { email: app.email, phone: app.phone } });
      await tx.agencyApplication.update({ where: { id: app.id }, data: { agencyId: created.agencyId } });
      await audit(actor, "application.approve", "AgencyApplication", app.id, undefined, { agencyId: created.agencyId }, tx);
      return { agencyId: created.agencyId, created };
    });
  } catch (error) {
    if (error instanceof ApprovalRefused) return { ok: false, error: error.message };
    // The email got a user since the application was sent: everything rolled back, still pending.
    if (isDuplicateUserEmail(error)) return { ok: false, error: DUPLICATE_USER };
    throw error;
  }
  if (!outcome.created) return { ok: true, agencyId: outcome.agencyId };
  return { ok: true, agencyId: outcome.agencyId, emailSent: await sendAgencyInvitation(outcome.created) };
}

export async function rejectApplication(actor: string, id: string): Promise<ReviewResult> {
  if (typeof id !== "string" || id.length > 64) return { ok: false, error: "This application was not found." };
  return db.$transaction(async (tx) => {
    const done = await tx.agencyApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: actor } });
    if (done.count === 0) return { ok: false, error: NOT_PENDING } as const;
    await audit(actor, "application.reject", "AgencyApplication", id, undefined, undefined, tx);
    return { ok: true } as const;
  });
}

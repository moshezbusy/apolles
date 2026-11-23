import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveApplication, listApplications, rejectApplication, submitApplication } from "@/server/applications";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  }),
}));
vi.mock("@/server/auth/password-tokens", () => ({ sendSetPasswordEmail: vi.fn(async () => {}) }));

const FORM = {
  agencyName: "Sunrise Travel",
  contactName: "Dana Cohen",
  email: "Dana@Sunrise.example",
  phone: "+972 50 555 0100",
  country: "IL",
  website: "sunrise.example",
  license: "IATA 12345678",
  notes: "We sell Mexico.",
  terms: "on",
  company: "",
};

let admin: string;

beforeEach(async () => {
  await resetTestDb();
  sent.length = 0;
  vi.mocked(sendEmail).mockClear();
  admin = (await createUser({ email: "admin@apolles.test", name: "Admin", role: "ADMIN" })).id;
});

describe("join (screen 02)", () => {
  it("saves a pending application, emails the applicant and the admin (no applicant details to the admin)", async () => {
    expect(await submitApplication(FORM, "203.0.113.9")).toEqual({ ok: true });
    const app = await db.agencyApplication.findFirstOrThrow();
    expect(app).toMatchObject({ status: "PENDING", email: "dana@sunrise.example", agencyName: "Sunrise Travel", country: "IL", license: "IATA 12345678" });
    expect(sent.map((m) => m.to).sort()).toEqual(["alerts@test.local", "dana@sunrise.example"]);
    const toAdmin = sent.find((m) => m.to === "alerts@test.local")!;
    expect(toAdmin.text).not.toContain("Sunrise");
    expect(toAdmin.text).not.toContain("dana@");
    expect(toAdmin.text).toContain("/admin/applications");
    // Nothing the applicant typed goes into an email (it could be sent to anyone's address).
    const toApplicant = sent.find((m) => m.to === "dana@sunrise.example")!;
    expect(toApplicant.text).not.toContain("Dana");
    expect(toApplicant.text.startsWith("Hello,")).toBe(true);
  });

  it("refuses bad input, unknown fields, no terms; a filled honeypot looks fine but saves nothing", async () => {
    for (const bad of [
      { ...FORM, email: "nope" },
      { ...FORM, country: "XX" },
      { ...FORM, agencyName: "A‮gency" },
      { ...FORM, phone: "call me" },
      { ...FORM, terms: "" },
      { ...FORM, extra: "x" },
    ]) {
      expect((await submitApplication(bad as never, "203.0.113.9")).ok).toBe(false);
    }
    expect(await submitApplication({ ...FORM, company: "bot inc" }, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.agencyApplication.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("never tells who has a login: same answer; an existing user gets a note, a second application nothing", async () => {
    await createUser({ email: "taken@agency.example", name: "X", role: "ADMIN" });
    expect(await submitApplication({ ...FORM, email: "Taken@agency.example" }, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.agencyApplication.count()).toBe(0);
    expect(sent).toEqual([expect.objectContaining({ to: "taken@agency.example", subject: "You already have an Apolles account" })]);
    sent.length = 0;
    await submitApplication(FORM, "203.0.113.9");
    sent.length = 0;
    expect(await submitApplication(FORM, "203.0.113.10")).toEqual({ ok: true });
    expect(await db.agencyApplication.count()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("is limited per IP (IPv6 per /64), per email, and the admin is alerted once per 10 minutes", async () => {
    for (let i = 0; i < 5; i++) await submitApplication({ ...FORM, email: `a${i}@x.example` }, `2001:db8:1:2::${i + 1}`);
    expect(await submitApplication({ ...FORM, email: "a9@x.example" }, "2001:db8:1:2:ffff::9")).toEqual({ ok: false, error: "limited" });
    expect(await submitApplication({ ...FORM, email: "b1@x.example" }, "2001:db8:1:3::1")).toEqual({ ok: true });
    expect(sent.filter((m) => m.to === "alerts@test.local")).toHaveLength(1);
  });
});

describe("join: emails go out after the answer, and one flood cannot close the form", () => {
  it("with a deferring runner the answer comes back before any email is sent, for every outcome", async () => {
    const later: (() => Promise<void>)[] = [];
    const defer = (work: () => Promise<void>) => void later.push(work);
    await createUser({ email: "taken@agency.example", name: "X", role: "ADMIN" });

    // New applicant, an email that already has a login, and a second application: same answer,
    // and nothing has been sent (or counted for the admin alert) when the answer is given.
    expect(await submitApplication(FORM, "203.0.113.9", defer)).toEqual({ ok: true });
    expect(await submitApplication({ ...FORM, email: "taken@agency.example" }, "203.0.113.9", defer)).toEqual({ ok: true });
    expect(await submitApplication(FORM, "203.0.113.9", defer)).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await db.rateLimitBucket.count({ where: { key: "join:alert" } })).toBe(0);
    // The second application of the same address has no email at all.
    expect(later).toHaveLength(2);

    for (const work of later) await work();
    expect(sent.map((m) => m.subject).sort()).toEqual(["New Apolles agency application", "You already have an Apolles account", "Your Apolles application was received"]);
  });

  it("a failing email never changes the answer and is logged without the address", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submitApplication(FORM, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.agencyApplication.count()).toBe(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("dana@");
    logged.mockRestore();
  });

  it("over the overall hourly cap an application is still accepted and saved, but no email goes out", async () => {
    await seedRateLimit("join:all", 30, 60 * 60_000);
    expect(await submitApplication(FORM, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.agencyApplication.findFirstOrThrow()).toMatchObject({ status: "PENDING", email: "dana@sunrise.example" });
    expect(sent).toHaveLength(0);
    // An address that already has a login gets no note either while the cap is passed.
    await createUser({ email: "taken@agency.example", name: "X", role: "ADMIN" });
    expect(await submitApplication({ ...FORM, email: "taken@agency.example" }, "203.0.113.10")).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("the per-IP and per-email limits still refuse, also over the overall cap", async () => {
    await seedRateLimit("join:all", 30, 60 * 60_000);
    await seedRateLimit("join:ip:203.0.113.9", 5, 60 * 60_000);
    expect(await submitApplication(FORM, "203.0.113.9")).toEqual({ ok: false, error: "limited" });
    expect(await db.agencyApplication.count()).toBe(0);
  });
});

describe("admin review", () => {
  it("approve is one step: if opening the agency fails, nothing is left half-approved", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    // The agency cannot be made (the bank reference this agency would get is already taken).
    const seq = await db.$queryRaw<{ next: bigint }[]>`SELECT last_value + 1 AS next FROM pg_sequences WHERE sequencename = 'Agency_bankRefNo_seq'`;
    const taken = `APL-${String(Number(seq[0]?.next ?? 1)).padStart(4, "0")}`;
    await db.agency.create({ data: { name: "Blocker", country: "IL", bankReference: taken, bankRefNo: 900_000 } });
    await expect(approveApplication(admin, app.id)).rejects.toThrow();
    expect(await db.agencyApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "PENDING", agencyId: null, reviewedAt: null, reviewedById: null });
    expect(await db.user.count({ where: { email: "dana@sunrise.example" } })).toBe(0);
    expect(await db.agency.count({ where: { name: "Sunrise Travel" } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: { in: ["agency.create", "application.approve"] } } })).toBe(0);
  });

  it("an application left Approved with no agency (an old crash) is completed by approving it again", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    await db.agencyApplication.update({ where: { id: app.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: admin } });

    const result = await approveApplication(admin, app.id);
    expect(result).toMatchObject({ ok: true, emailSent: true });
    const agency = await db.agency.findFirstOrThrow({ where: { name: "Sunrise Travel" } });
    expect(await db.agencyApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "APPROVED", agencyId: agency.id });
    expect(await db.user.findUniqueOrThrow({ where: { email: "dana@sunrise.example" } })).toMatchObject({ role: "AGENT", agencyId: agency.id });
    // Once complete it cannot be approved a third time.
    expect(await approveApplication(admin, app.id)).toEqual({ ok: false, error: "This application was already reviewed." });
    expect(await db.agency.count()).toBe(1);
  });

  it("Approved with no agency, but the agency was in fact opened (an old failed link): approving again links it, makes nothing new", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    const agency = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-7777" } });
    await createUser({ email: "dana@sunrise.example", name: "Dana Cohen", role: "AGENT", agencyId: agency.id });
    await db.agencyApplication.update({ where: { id: app.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: admin } });

    expect(await approveApplication(admin, app.id)).toEqual({ ok: true, agencyId: agency.id });
    expect(await db.agencyApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "APPROVED", agencyId: agency.id });
    expect(await db.agency.count()).toBe(1);
    expect(await db.user.count()).toBe(2);
  });

  it("a rejected application cannot be approved", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    await rejectApplication(admin, app.id);
    expect(await approveApplication(admin, app.id)).toEqual({ ok: false, error: "This application was already reviewed." });
    expect(await db.agency.count()).toBe(0);
  });

  it("approve makes the agency and its agent once; the application keeps the agency id", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    const [first, second] = await Promise.all([approveApplication(admin, app.id), approveApplication(admin, app.id)]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const agency = await db.agency.findFirstOrThrow({ where: { name: "Sunrise Travel" } });
    expect(agency).toMatchObject({ country: "IL", email: "dana@sunrise.example", phone: "+972 50 555 0100" });
    expect(await db.user.findUniqueOrThrow({ where: { email: "dana@sunrise.example" } })).toMatchObject({ role: "AGENT", agencyId: agency.id, name: "Dana Cohen" });
    expect(await db.agencyApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "APPROVED", agencyId: agency.id, reviewedById: admin });
    expect(await db.auditLog.count({ where: { action: "application.approve", targetId: app.id } })).toBe(1);
    expect(await db.agency.count()).toBe(1);
  });

  it("an email taken since applying cannot be approved, and the application stays pending", async () => {
    await submitApplication(FORM, "203.0.113.9");
    const app = await db.agencyApplication.findFirstOrThrow();
    await createUser({ email: "dana@sunrise.example", name: "Y", role: "ADMIN" });
    expect(await approveApplication(admin, app.id)).toEqual({ ok: false, error: "A user with this email already exists." });
    expect(await db.agencyApplication.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "PENDING" });
    expect(await db.agency.count()).toBe(0);
  });

  it("reject; the list shows pending first and is paginated", async () => {
    for (let i = 0; i < 3; i++) await submitApplication({ ...FORM, email: `x${i}@agency.example` }, `203.0.113.${30 + i}`);
    const [a] = await db.agencyApplication.findMany({ orderBy: { createdAt: "asc" } });
    expect(await rejectApplication(admin, a!.id)).toEqual({ ok: true });
    expect(await rejectApplication(admin, a!.id)).toMatchObject({ ok: false });
    const pending = await listApplications({ status: "PENDING", take: 1 });
    expect(pending.rows).toHaveLength(1);
    expect(pending.nextCursor).not.toBeNull();
    const next = await listApplications({ status: "PENDING", take: 1, cursor: pending.nextCursor! });
    expect(next.rows).toHaveLength(1);
    expect((await listApplications({ status: "REJECTED" })).rows.map((r) => r.id)).toEqual([a!.id]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveApplication, listApplications, rejectApplication, submitApplication } from "@/server/applications";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

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

  it("an email that already has a user or a pending application is refused", async () => {
    await createUser({ email: "taken@agency.example", name: "X", role: "ADMIN" });
    expect(await submitApplication({ ...FORM, email: "Taken@agency.example" }, "203.0.113.9")).toEqual({ ok: false, error: "duplicate" });
    await submitApplication(FORM, "203.0.113.9");
    expect(await submitApplication(FORM, "203.0.113.10")).toEqual({ ok: false, error: "duplicate" });
  });

  it("is limited per IP and per email", async () => {
    for (let i = 0; i < 5; i++) await submitApplication({ ...FORM, email: `a${i}@x.example` }, "203.0.113.20");
    expect(await submitApplication({ ...FORM, email: "a9@x.example" }, "203.0.113.20")).toEqual({ ok: false, error: "limited" });
  });
});

describe("admin review", () => {
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

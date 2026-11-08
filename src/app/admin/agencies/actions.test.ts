import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { sendEmail } from "@/server/email/port";
import { createAgencyAction, setAgencyStatusAction } from "@/app/admin/agencies/actions";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const good = {
  name: "Sunrise Travel",
  country: "IL",
  agentName: "Dana",
  agentEmail: "dana@example.com",
};

async function signInAdmin(verified = true) {
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  await db.user.update({
    where: { id: admin.id },
    data: { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", totpConfirmedAt: new Date() },
  });
  const token = await createSession(admin.id);
  if (verified) {
    await db.session.updateMany({ where: { userId: admin.id }, data: { totpVerifiedAt: new Date() } });
  }
  jar.set(SESSION_COOKIE, token);
  return admin;
}

describe("agency server actions", () => {
  beforeEach(async () => {
    await resetTestDb();
    jar.clear();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue(undefined);
  });

  it("createAgencyAction without a session → redirect to /login, nothing created", async () => {
    await expect(createAgencyAction(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await db.agency.count()).toBe(0);
  });

  it("createAgencyAction with an admin whose code is not entered → redirect to /admin/2fa", async () => {
    await signInAdmin(false);
    await expect(createAgencyAction(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/admin/2fa");
    expect(await db.agency.count()).toBe(0);
  });

  it("an agent cannot call the actions", async () => {
    const agency = await db.agency.create({ data: { name: "A", country: "IL", bankReference: "APL-9" } });
    const agent = await createUser({ email: "ag@example.com", name: "Ag", role: "AGENT", agencyId: agency.id });
    jar.set(SESSION_COOKIE, await createSession(agent.id));
    await expect(createAgencyAction(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(
      setAgencyStatusAction(form({ agencyId: agency.id, status: "SUSPENDED" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
    expect((await db.agency.findUniqueOrThrow({ where: { id: agency.id } })).status).toBe("ACTIVE");
  });

  it("rejects a bad country and creates nothing", async () => {
    await signInAdmin();
    for (const country of ["ISR", "I", "1L", ""]) {
      const state = await createAgencyAction(null, form({ ...good, country }));
      expect(state?.error).toBeTruthy();
    }
    expect(await db.agency.count()).toBe(0);
  });

  it("accepts a lowercase country and stores it uppercase", async () => {
    await signInAdmin();
    await expect(createAgencyAction(null, form({ ...good, country: " il " }))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/agencies",
    );
    expect((await db.agency.findFirstOrThrow()).country).toBe("IL");
  });

  it("rejects bad name / agent name / email", async () => {
    await signInAdmin();
    for (const bad of [
      { name: "A" },
      { name: "x".repeat(101) },
      { agentName: "" },
      { agentName: "x".repeat(101) },
      { agentEmail: "not-an-email" },
      { agentEmail: `${"a".repeat(250)}@x.com` },
    ]) {
      const state = await createAgencyAction(null, form({ ...good, ...bad }));
      expect(state?.error).toBeTruthy();
    }
    expect(await db.agency.count()).toBe(0);
  });

  it("valid input → agency created, audit actor is the admin, redirects to the list", async () => {
    const admin = await signInAdmin();
    await expect(createAgencyAction(null, form(good))).rejects.toThrow("NEXT_REDIRECT:/admin/agencies");
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.create" } });
    expect(row.actorUserId).toBe(admin.id);
  });

  it("duplicate email → the exact message, nothing created", async () => {
    await signInAdmin();
    await createUser({ email: "dana@example.com", name: "x", role: "ADMIN" });
    const state = await createAgencyAction(null, form(good));
    expect(state).toEqual({ error: "A user with this email already exists" });
    expect(await db.agency.count()).toBe(0);
  });

  it("email failure → agency exists and the admin is told", async () => {
    await signInAdmin();
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await createAgencyAction(null, form(good));
    expect(state?.created).toBe(true);
    expect(state?.error).toMatch(/^Agency created, but the email could not be sent\./);
    expect(await db.agency.count()).toBe(1);
  });

  it("setAgencyStatusAction suspends, audits with the admin as actor", async () => {
    const admin = await signInAdmin();
    const agency = await db.agency.create({ data: { name: "A", country: "IL", bankReference: "APL-9" } });
    await expect(
      setAgencyStatusAction(form({ agencyId: agency.id, status: "SUSPENDED" })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/agencies");
    expect((await db.agency.findUniqueOrThrow({ where: { id: agency.id } })).status).toBe("SUSPENDED");
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.suspend" } });
    expect(row.actorUserId).toBe(admin.id);
  });

  it("setAgencyStatusAction ignores an invalid status", async () => {
    await signInAdmin();
    const agency = await db.agency.create({ data: { name: "A", country: "IL", bankReference: "APL-9" } });
    await expect(
      setAgencyStatusAction(form({ agencyId: agency.id, status: "DELETED" })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin/agencies");
    expect((await db.agency.findUniqueOrThrow({ where: { id: agency.id } })).status).toBe("ACTIVE");
    expect(await db.auditLog.count()).toBe(0);
  });
});

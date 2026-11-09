import { generateSecret } from "otplib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { requireAdmin, requireAdminPendingTotp, requireAgent } from "@/server/auth/guards";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

// Like the real redirect(), the mock throws so code after it never runs.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

async function agentSession() {
  const agency = await db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: "APL-0001" },
  });
  const agent = await createUser({ email: "agent@example.com", name: "A", role: "AGENT", agencyId: agency.id });
  cookieJar.set(SESSION_COOKIE, await createSession(agent.id));
  return { agent, agency };
}

type AdminState = { confirmed?: boolean; verified?: boolean };

// An admin session: TOTP set up (confirmed) or not, and this session verified or not.
async function adminSession({ confirmed = false, verified = false }: AdminState = {}) {
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  if (confirmed) {
    await db.user.update({
      where: { id: admin.id },
      data: { totpSecret: generateSecret(), totpConfirmedAt: new Date() },
    });
  }
  const token = await createSession(admin.id);
  if (verified) {
    await db.session.updateMany({ where: { userId: admin.id }, data: { totpVerifiedAt: new Date() } });
  }
  cookieJar.set(SESSION_COOKIE, token);
  const { id: sessionId } = await db.session.findFirstOrThrow({ where: { userId: admin.id } });
  return { admin, sessionId };
}

describe("auth guards", () => {
  beforeEach(async () => {
    await resetTestDb();
    cookieJar.clear();
  });

  it("requireAgent with a valid agent session → userId and agencyId", async () => {
    const { agent, agency } = await agentSession();
    expect(await requireAgent()).toEqual({ userId: agent.id, agencyId: agency.id });
  });

  it("requireAgent with no cookie redirects to /login", async () => {
    await expect(requireAgent()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAgent with an unknown token redirects to /login", async () => {
    cookieJar.set(SESSION_COOKIE, "forged-token");
    await expect(requireAgent()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAgent with an ADMIN session redirects to /login", async () => {
    await adminSession();
    await expect(requireAgent()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAgent after the agency is suspended redirects to /login", async () => {
    const { agency } = await agentSession();
    await db.agency.update({ where: { id: agency.id }, data: { status: "SUSPENDED" } });
    await expect(requireAgent()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAdmin with a TOTP-verified admin session → userId", async () => {
    const { admin } = await adminSession({ confirmed: true, verified: true });
    expect(await requireAdmin()).toEqual({ userId: admin.id });
  });

  it("admin session without totpVerifiedAt → requireAdmin redirects to /admin/2fa", async () => {
    await adminSession({ confirmed: true, verified: false });
    await expect(requireAdmin()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
  });

  it("admin who has not set up TOTP → requireAdmin redirects to /admin/2fa/setup", async () => {
    await adminSession({ confirmed: false });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/admin/2fa/setup");
  });

  it("verification belongs to one session: a new session of the same admin is not verified", async () => {
    const { admin } = await adminSession({ confirmed: true, verified: true });
    cookieJar.set(SESSION_COOKIE, await createSession(admin.id));
    await expect(requireAdmin()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
  });

  it("an unconfirmed admin is sent to setup even if the session was marked verified", async () => {
    await adminSession({ confirmed: false, verified: true });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/admin/2fa/setup");
  });

  it("requireAdminPendingTotp with an unverified admin session → ids and setup state", async () => {
    const pending = await adminSession({ confirmed: true });
    expect(await requireAdminPendingTotp()).toEqual({
      userId: pending.admin.id,
      sessionId: pending.sessionId,
      totpConfirmed: true,
    });
    await db.user.update({ where: { id: pending.admin.id }, data: { totpConfirmedAt: null } });
    expect(await requireAdminPendingTotp()).toMatchObject({ totpConfirmed: false });
  });

  it("requireAdminPendingTotp with an already verified session → redirects to /admin", async () => {
    await adminSession({ confirmed: true, verified: true });
    await expect(requireAdminPendingTotp()).rejects.toThrow(/^NEXT_REDIRECT:\/admin$/);
  });

  it("requireAdminPendingTotp with an AGENT session or no cookie → /login", async () => {
    await expect(requireAdminPendingTotp()).rejects.toThrow("NEXT_REDIRECT:/login");
    await agentSession();
    await expect(requireAdminPendingTotp()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAdmin with an AGENT session redirects to /login", async () => {
    await agentSession();
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAdmin with no cookie redirects to /login", async () => {
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

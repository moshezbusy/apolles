import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { requireAdmin, requireAgent } from "@/server/auth/guards";

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

async function adminSession() {
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  cookieJar.set(SESSION_COOKIE, await createSession(admin.id));
  return admin;
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

  it("requireAdmin with a valid admin session → userId", async () => {
    const admin = await adminSession();
    expect(await requireAdmin()).toEqual({ userId: admin.id });
  });

  it("requireAdmin with an AGENT session redirects to /login", async () => {
    await agentSession();
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireAdmin with no cookie redirects to /login", async () => {
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

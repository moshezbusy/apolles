import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import {
  SESSION_TTL_MS,
  createSession,
  destroySession,
  destroyUserSessions,
  getSession,
} from "@/server/auth/session";

async function createAgency(bankReference = "APL-0001") {
  return db.agency.create({ data: { name: "Agency", country: "IL", bankReference } });
}

async function createAgent(email = "agent@example.com", agencyId?: string) {
  const id = agencyId ?? (await createAgency()).id;
  return createUser({ email, name: "Agent", role: "AGENT", agencyId: id });
}

describe("sessions", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores only the sha256 of a 32-byte random token, expiring 12h after creation", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id);

    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(row.tokenHash).not.toContain(raw);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("valid agent session → user and agency, without secrets", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id);

    const session = await getSession(raw);
    expect(session).not.toBeNull();
    expect(session?.sessionId).toEqual(expect.any(String));
    expect(session?.user).toMatchObject({ id: agent.id, role: "AGENT", email: agent.email });
    expect(session?.user).not.toHaveProperty("passwordHash");
    expect(session?.user).not.toHaveProperty("totpSecret");
    expect(session?.agency).toMatchObject({ id: agent.agencyId, status: "ACTIVE" });
  });

  it("valid admin session → user without agency", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    const session = await getSession(await createSession(admin.id));
    expect(session?.user.role).toBe("ADMIN");
    expect(session).not.toHaveProperty("agency");
  });

  it("unknown or empty token → null", async () => {
    expect(await getSession("nope")).toBeNull();
    expect(await getSession("")).toBeNull();
  });

  it("session older than 12h → getSession null", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-08T10:00:00Z");
    vi.setSystemTime(start);
    const agent = await createAgent();
    const raw = await createSession(agent.id);

    vi.setSystemTime(start.getTime() + SESSION_TTL_MS - 1000);
    expect(await getSession(raw)).not.toBeNull();

    vi.setSystemTime(start.getTime() + SESSION_TTL_MS);
    expect(await getSession(raw)).toBeNull();
    // Expired rows are removed on read.
    expect(await db.session.count()).toBe(0);
  });

  it("suspended agency → getSession null", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id);
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });
    expect(await getSession(raw)).toBeNull();
  });

  it("suspended user → getSession null", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id);
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await getSession(raw)).toBeNull();
  });

  it("AGENT without an agency → getSession null", async () => {
    const agent = await createUser({ email: "orphan@example.com", name: "A", role: "AGENT" });
    expect(await getSession(await createSession(agent.id))).toBeNull();
  });

  it("destroySession deletes only that session", async () => {
    const agent = await createAgent();
    const a = await createSession(agent.id);
    const b = await createSession(agent.id);
    await destroySession(a);
    expect(await getSession(a)).toBeNull();
    expect(await getSession(b)).not.toBeNull();
  });

  it("destroyUserSessions deletes every session of that user only", async () => {
    const agency = await createAgency();
    const one = await createAgent("one@example.com", agency.id);
    const two = await createAgent("two@example.com", agency.id);
    await createSession(one.id);
    await createSession(one.id);
    const other = await createSession(two.id);

    await destroyUserSessions(one.id);
    expect(await db.session.count({ where: { userId: one.id } })).toBe(0);
    expect(await getSession(other)).not.toBeNull();
  });
});

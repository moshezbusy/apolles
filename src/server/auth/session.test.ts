import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  destroyUserSessions,
  getSession,
  rotateSessionToken,
  sessionCookieOptions,
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
    const raw = await createSession(agent.id, { verified: true });

    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(row.tokenHash).not.toContain(raw);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("rotateSessionToken: the session gets a new token, the old one stops working, nothing else changes", async () => {
    const agent = await createAgent();
    const old = await createSession(agent.id, { verified: true });
    const before = await getSession(old);

    const renewed = await rotateSessionToken(before!.sessionId);
    expect(renewed).not.toBeNull();
    expect(renewed!.token).not.toBe(old);
    expect(Buffer.from(renewed!.token, "base64url")).toHaveLength(32);
    expect(await getSession(old)).toBeNull();
    const after = await getSession(renewed!.token);
    expect(after).toMatchObject({ sessionId: before!.sessionId, emailVerifiedAt: before!.emailVerifiedAt });
    expect(await db.session.count()).toBe(1);
    // Only the hash of the new token is stored, and the 12-hour end of the session is not moved.
    const row = await db.session.findFirstOrThrow();
    expect(row.tokenHash).toBe(createHash("sha256").update(renewed!.token).digest("hex"));
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(SESSION_TTL_MS);
    expect(renewed!.maxAgeSeconds).toBeGreaterThan(SESSION_TTL_MS / 1000 - 60);
    expect(renewed!.maxAgeSeconds).toBeLessThanOrEqual(SESSION_TTL_MS / 1000);
  });

  it("rotateSessionToken: an unknown or expired session gets nothing", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id, { verified: true });
    const { sessionId } = (await getSession(raw))!;
    expect(await rotateSessionToken("nope")).toBeNull();
    await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await rotateSessionToken(sessionId)).toBeNull();
  });

  // The __Host- prefix makes the browser refuse the cookie unless it is Secure, has Path=/ and
  // no Domain: it cannot be set or overwritten from another subdomain or over plain http.
  it("the session cookie uses the __Host- prefix, with the attributes the prefix requires", () => {
    expect(SESSION_COOKIE).toBe("__Host-apl_session");
    expect(sessionCookieOptions(3600)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    expect(sessionCookieOptions(3600)).not.toHaveProperty("domain");
  });

  it("valid agent session → user and agency, without secrets", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id, { verified: true });

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
    const session = await getSession(await createSession(admin.id, { verified: true }));
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
    const raw = await createSession(agent.id, { verified: true });

    vi.setSystemTime(start.getTime() + SESSION_TTL_MS - 1000);
    expect(await getSession(raw)).not.toBeNull();

    vi.setSystemTime(start.getTime() + SESSION_TTL_MS);
    expect(await getSession(raw)).toBeNull();
    // Expired rows are removed on read.
    expect(await db.session.count()).toBe(0);
  });

  it("suspended agency → getSession null", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id, { verified: true });
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });
    expect(await getSession(raw)).toBeNull();
  });

  it("suspended user → getSession null", async () => {
    const agent = await createAgent();
    const raw = await createSession(agent.id, { verified: true });
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await getSession(raw)).toBeNull();
  });

  it("AGENT without an agency → getSession null", async () => {
    const agent = await createUser({ email: "orphan@example.com", name: "A", role: "AGENT" });
    expect(await getSession(await createSession(agent.id, { verified: true }))).toBeNull();
  });

  it("destroySession deletes only that session", async () => {
    const agent = await createAgent();
    const a = await createSession(agent.id, { verified: true });
    const b = await createSession(agent.id, { verified: true });
    await destroySession(a);
    expect(await getSession(a)).toBeNull();
    expect(await getSession(b)).not.toBeNull();
  });

  it("destroyUserSessions deletes every session of that user only", async () => {
    const agency = await createAgency();
    const one = await createAgent("one@example.com", agency.id);
    const two = await createAgent("two@example.com", agency.id);
    await createSession(one.id, { verified: true });
    await createSession(one.id, { verified: true });
    const other = await createSession(two.id, { verified: true });

    await destroyUserSessions(one.id);
    expect(await db.session.count({ where: { userId: one.id } })).toBe(0);
    expect(await getSession(other)).not.toBeNull();
  });
});

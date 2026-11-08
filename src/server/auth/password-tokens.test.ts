import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { sendEmail } from "@/server/email/port";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import {
  PASSWORD_TOKEN_TTL_MS,
  consumePasswordToken,
  findUsablePasswordToken,
  issuePasswordToken,
  requestReset,
  sendSetPasswordEmail,
} from "@/server/auth/password-tokens";

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

const APP_URL = "http://localhost:3000";
const OLD = "oldpass12";
const NEW = "newpass34";

async function createAgent(email = "agent@example.com") {
  const agency = await db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: "APL-0001" },
  });
  return createUser({
    email,
    name: "Agent",
    role: "AGENT",
    agencyId: agency.id,
    passwordHash: await hashPassword(OLD),
  });
}

async function storedHash(userId: string): Promise<string> {
  const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return row.passwordHash!;
}

// The raw token from the one link in an email body.
function tokenFromEmail(text: string): string {
  const match = new RegExp(`${APP_URL}/set-password/([A-Za-z0-9_-]+)`).exec(text);
  if (!match?.[1]) throw new Error("no set-password link in the email");
  return match[1];
}

describe("password tokens", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_URL", APP_URL);
    vi.mocked(sendEmail).mockReset();
    await resetTestDb();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores only the sha256 of a 32-byte random token, valid for 60 minutes", async () => {
    const agent = await createAgent();
    const before = Date.now();
    const raw = await issuePasswordToken(agent.id, "RESET");

    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    const rows = await db.passwordToken.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.tokenHash).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(row.purpose).toBe("RESET");
    expect(row.usedAt).toBeNull();
    expect(PASSWORD_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + PASSWORD_TOKEN_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + PASSWORD_TOKEN_TTL_MS);
  });

  it("token used twice → second EXPIRED and password unchanged", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "RESET");

    expect(await consumePasswordToken(raw, NEW)).toBe("OK");
    const afterFirst = await storedHash(agent.id);
    expect(await verifyPassword(afterFirst, NEW)).toBe(true);

    expect(await consumePasswordToken(raw, "another99")).toBe("EXPIRED");
    expect(await storedHash(agent.id)).toBe(afterFirst);
  });

  it("token after 61 minutes → EXPIRED", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-08T10:00:00Z");
    vi.setSystemTime(start);
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "SET");

    vi.setSystemTime(start.getTime() + 61 * 60 * 1000);
    expect(await findUsablePasswordToken(raw)).toBeNull();
    expect(await consumePasswordToken(raw, NEW)).toBe("EXPIRED");
    expect(await verifyPassword(await storedHash(agent.id), OLD)).toBe(true);
  });

  it("token at 59 minutes still works", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-08T10:00:00Z");
    vi.setSystemTime(start);
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "SET");

    vi.setSystemTime(start.getTime() + 59 * 60 * 1000);
    expect(await consumePasswordToken(raw, NEW)).toBe("OK");
  });

  it("consume OK → all sessions of user deleted, lockout cleared", async () => {
    const agent = await createAgent();
    const other = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    await createSession(agent.id);
    await createSession(agent.id);
    await createSession(other.id);
    await db.user.update({
      where: { id: agent.id },
      data: { failedLogins: 2, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
    });
    const raw = await issuePasswordToken(agent.id, "RESET");

    expect(await consumePasswordToken(raw, NEW)).toBe("OK");

    expect(await db.session.count({ where: { userId: agent.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: other.id } })).toBe(1);
    const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(await verifyPassword(row.passwordHash!, NEW)).toBe(true);
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    const token = await db.passwordToken.findFirstOrThrow();
    expect(token.usedAt).not.toBeNull();
  });

  it("INVALID_PASSWORD leaves the token usable", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "RESET");

    expect(await consumePasswordToken(raw, "short1")).toBe("INVALID_PASSWORD");
    expect(await consumePasswordToken(raw, "lettersonly")).toBe("INVALID_PASSWORD");
    expect(await consumePasswordToken(raw, "12345678")).toBe("INVALID_PASSWORD");
    expect(await verifyPassword(await storedHash(agent.id), OLD)).toBe(true);

    expect(await findUsablePasswordToken(raw)).toBe("RESET");
    expect(await consumePasswordToken(raw, NEW)).toBe("OK");
  });

  it("issuing a new token invalidates the old one", async () => {
    const agent = await createAgent();
    const first = await issuePasswordToken(agent.id, "SET");
    const second = await issuePasswordToken(agent.id, "RESET");

    expect(await findUsablePasswordToken(first)).toBeNull();
    expect(await consumePasswordToken(first, NEW)).toBe("EXPIRED");
    expect(await findUsablePasswordToken(second)).toBe("RESET");
    expect(await consumePasswordToken(second, NEW)).toBe("OK");
  });

  it("issuing for one user does not touch another user's token", async () => {
    const agent = await createAgent();
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    const agentToken = await issuePasswordToken(agent.id, "RESET");
    await issuePasswordToken(admin.id, "SET");
    expect(await findUsablePasswordToken(agentToken)).toBe("RESET");
  });

  it("two concurrent consumes of the same token → exactly one OK", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "RESET");

    const results = await Promise.all([
      consumePasswordToken(raw, "parallel1"),
      consumePasswordToken(raw, "parallel2"),
      consumePasswordToken(raw, "parallel3"),
    ]);
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "EXPIRED")).toHaveLength(2);
  });

  it("issuing a new link while the old one is being used → both finish without error", async () => {
    const agent = await createAgent();
    for (let i = 0; i < 5; i++) {
      const raw = await issuePasswordToken(agent.id, "RESET");
      const [result, fresh] = await Promise.all([
        consumePasswordToken(raw, NEW),
        issuePasswordToken(agent.id, "RESET"),
      ]);
      expect(["OK", "EXPIRED"]).toContain(result);
      expect(typeof fresh).toBe("string");
    }
  });

  it("suspended user → EXPIRED, password unchanged", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "RESET");
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });

    expect(await findUsablePasswordToken(raw)).toBeNull();
    expect(await consumePasswordToken(raw, NEW)).toBe("EXPIRED");
    expect(await verifyPassword(await storedHash(agent.id), OLD)).toBe(true);
  });

  it("agent of a suspended agency → EXPIRED, password unchanged", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "RESET");
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });

    expect(await findUsablePasswordToken(raw)).toBeNull();
    expect(await consumePasswordToken(raw, NEW)).toBe("EXPIRED");
    expect(await verifyPassword(await storedHash(agent.id), OLD)).toBe(true);
  });

  it("unknown, empty or oversized token → EXPIRED", async () => {
    await createAgent();
    expect(await consumePasswordToken("nope", NEW)).toBe("EXPIRED");
    expect(await consumePasswordToken("", NEW)).toBe("EXPIRED");
    expect(await consumePasswordToken("a".repeat(500), NEW)).toBe("EXPIRED");
    expect(await findUsablePasswordToken("nope")).toBeNull();
    expect(await findUsablePasswordToken("")).toBeNull();
  });

  it("findUsablePasswordToken reads the purpose without consuming the token", async () => {
    const agent = await createAgent();
    const raw = await issuePasswordToken(agent.id, "SET");
    expect(await findUsablePasswordToken(raw)).toBe("SET");
    expect(await findUsablePasswordToken(raw)).toBe("SET");
    expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("requestReset unknown email → resolves, sendEmail not called", async () => {
    await createAgent();
    await expect(requestReset("nobody@example.com")).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await db.passwordToken.count()).toBe(0);
  });

  it("requestReset for an existing active user sends one email with a working link", async () => {
    const agent = await createAgent();
    await expect(requestReset("  Agent@Example.COM ")).resolves.toBeUndefined();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(msg.to).toBe("agent@example.com");
    expect(msg.subject).toBe("Reset your Apolles password");
    expect(msg.text).toContain(`${APP_URL}/set-password/`);
    expect(msg.text).toContain("This link expires in 60 minutes and can be used once.");

    const raw = tokenFromEmail(msg.text);
    expect(await findUsablePasswordToken(raw)).toBe("RESET");
    expect(await consumePasswordToken(raw, NEW)).toBe("OK");
    expect(await verifyPassword(await storedHash(agent.id), NEW)).toBe(true);
  });

  it("requestReset for a suspended user or suspended agency → no email", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    await requestReset("agent@example.com");

    await db.user.update({ where: { id: agent.id }, data: { status: "ACTIVE" } });
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });
    await requestReset("agent@example.com");

    expect(sendEmail).not.toHaveBeenCalled();
    expect(await db.passwordToken.count()).toBe(0);
  });

  it("requestReset works for an admin (no agency)", async () => {
    await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    await requestReset("admin@example.com");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("requestReset when sending fails → still resolves, the log has no token", async () => {
    await createAgent();
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("Postmark send failed: HTTP 500"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(requestReset("agent@example.com")).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorLog.mock.calls);
    const msg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(logged).not.toContain(tokenFromEmail(msg.text));
    expect(logged).not.toContain("set-password");
  });

  it("sendSetPasswordEmail sends a SET link to the user", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    await sendSetPasswordEmail(admin.id);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(msg.to).toBe("admin@example.com");
    expect(msg.subject).toBe("Set your Apolles password");
    expect(msg.text).toContain("This link expires in 60 minutes and can be used once.");
    expect(await findUsablePasswordToken(tokenFromEmail(msg.text))).toBe("SET");
  });

  it("refuses to build a link when APP_URL is missing", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    vi.stubEnv("APP_URL", "");
    await expect(sendSetPasswordEmail(admin.id)).rejects.toThrow(/APP_URL/);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

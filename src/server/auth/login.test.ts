import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import * as password from "@/server/auth/password";
import { LOGIN_ERROR_COPY, login } from "@/server/auth/login";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const GOOD = "abcdefg1";
const BAD = "wrong-pass1";
const FIFTEEN_MIN = 15 * 60 * 1000;

let passwordHash: string;

async function createAgency(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  return db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: "APL-0001", status },
  });
}

async function createAgent(email = "agent@example.com") {
  const agency = await createAgency();
  return createUser({ email, name: "Agent", role: "AGENT", agencyId: agency.id, passwordHash });
}

describe("login", () => {
  beforeEach(async () => {
    passwordHash ??= await password.hashPassword(GOOD);
    await resetTestDb();
    vi.mocked(notifyAdminLockout).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("correct password → ok, agent does not need TOTP", async () => {
    const agent = await createAgent();
    expect(await login("agent@example.com", GOOD)).toEqual({
      ok: true,
      userId: agent.id,
      needsTotp: false,
    });
  });

  it("normalizes the email before lookup", async () => {
    const agent = await createAgent();
    expect(await login("  Agent@Example.COM ", GOOD)).toMatchObject({ ok: true, userId: agent.id });
  });

  it("admin with correct password → needsTotp true", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    expect(await login("admin@example.com", GOOD)).toEqual({
      ok: true,
      userId: admin.id,
      needsTotp: true,
    });
  });

  it("wrong password ×3 → third returns LOCKED and notifyAdminLockout called once", async () => {
    const agent = await createAgent();
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "LOCKED" });

    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyAdminLockout).mock.calls[0]?.[0]).toMatchObject({
      id: agent.id,
      email: agent.email,
    });
    const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.lockedUntil).not.toBeNull();
    expect(row.failedLogins).toBe(0);
  });

  it("correct password while locked → LOCKED (password not even checked)", async () => {
    const agent = await createAgent();
    for (let i = 0; i < 3; i++) await login(agent.email, BAD);

    const verify = vi.spyOn(password, "verifyPassword");
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "LOCKED" });
    expect(verify).not.toHaveBeenCalled();
    // Locked attempts do not extend the lock or count as failures, and alert only once.
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "LOCKED" });
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
  });

  it("after 15 minutes (fake timers) → correct password ok", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-08T10:00:00Z").getTime();
    vi.setSystemTime(start);
    const agent = await createAgent();
    for (let i = 0; i < 3; i++) await login(agent.email, BAD);

    vi.setSystemTime(start + FIFTEEN_MIN - 1000);
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "LOCKED" });

    vi.setSystemTime(start + FIFTEEN_MIN);
    expect(await login(agent.email, GOOD)).toMatchObject({ ok: true, userId: agent.id });
  });

  it("after the lock expires the counter starts fresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-08T10:00:00Z").getTime();
    vi.setSystemTime(start);
    const agent = await createAgent();
    for (let i = 0; i < 3; i++) await login(agent.email, BAD);

    vi.setSystemTime(start + FIFTEEN_MIN + 1000);
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "LOCKED" });
    expect(notifyAdminLockout).toHaveBeenCalledTimes(2);
  });

  it("unknown email → INVALID (same as wrong password), with a dummy hash check", async () => {
    const agent = await createAgent();
    const wrong = await login(agent.email, BAD);
    const verify = vi.spyOn(password, "verifyPassword");

    const unknown = await login("nobody@example.com", BAD);
    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({ ok: false, reason: "INVALID" });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(password.DUMMY_PASSWORD_HASH, BAD);
  });

  it("user without a password yet → INVALID, with a dummy hash check, never locks", async () => {
    await createUser({ email: "new@example.com", name: "New", role: "ADMIN" });
    const verify = vi.spyOn(password, "verifyPassword");
    for (let i = 0; i < 4; i++) {
      expect(await login("new@example.com", BAD)).toEqual({ ok: false, reason: "INVALID" });
    }
    expect(verify).toHaveBeenCalledTimes(4);
    expect(notifyAdminLockout).not.toHaveBeenCalled();
  });

  it("success resets failedLogins", async () => {
    const agent = await createAgent();
    await login(agent.email, BAD);
    await login(agent.email, BAD);
    expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).failedLogins).toBe(2);

    expect(await login(agent.email, GOOD)).toMatchObject({ ok: true });
    const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.failedLogins).toBe(0);
    expect(row.lockedUntil).toBeNull();
    // A fresh run of two failures does not lock.
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("suspended user with right password → SUSPENDED", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "SUSPENDED" });
  });

  it("suspended user with wrong password → INVALID (suspension not revealed)", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("agent of a suspended agency with right password → SUSPENDED", async () => {
    const agent = await createAgent();
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "SUSPENDED" });
  });

  it("concurrent wrong passwords alert the admin exactly once", async () => {
    const agent = await createAgent();
    await login(agent.email, BAD);
    await login(agent.email, BAD);
    const results = await Promise.all([login(agent.email, BAD), login(agent.email, BAD)]);
    expect(results.every((r) => !r.ok && r.reason === "LOCKED")).toBe(true);
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).failedLogins).toBe(0);
  });

  it("a wrong password that finishes after a parallel attempt locked the account → LOCKED, not counted", async () => {
    const agent = await createAgent();
    vi.spyOn(password, "verifyPassword").mockImplementationOnce(async () => {
      // Another request locks the account while this one is still checking the password.
      await db.user.update({
        where: { id: agent.id },
        data: { lockedUntil: new Date(Date.now() + FIFTEEN_MIN), failedLogins: 0 },
      });
      return false;
    });
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "LOCKED" });
    expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).failedLogins).toBe(0);
    expect(notifyAdminLockout).not.toHaveBeenCalled();
  });

  it("a correct password that finishes after a parallel attempt locked the account → LOCKED, lock kept", async () => {
    const agent = await createAgent();
    const lockedUntil = new Date(Date.now() + FIFTEEN_MIN);
    vi.spyOn(password, "verifyPassword").mockImplementationOnce(async () => {
      // Parallel wrong guesses lock the account while this (correct) guess is being checked.
      await db.user.update({ where: { id: agent.id }, data: { lockedUntil, failedLogins: 0 } });
      return true;
    });
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "LOCKED" });
    const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.lockedUntil?.getTime()).toBe(lockedUntil.getTime());
  });

  it("a failing lockout alert still locks the account", async () => {
    vi.mocked(notifyAdminLockout).mockRejectedValueOnce(new Error("mail down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = await createAgent();
    await login(agent.email, BAD);
    await login(agent.email, BAD);
    expect(await login(agent.email, BAD)).toEqual({ ok: false, reason: "LOCKED" });
    expect(await login(agent.email, GOOD)).toEqual({ ok: false, reason: "LOCKED" });
  });

  it("exact copy for each failure reason", () => {
    expect(LOGIN_ERROR_COPY).toEqual({
      INVALID: "Wrong email or password.",
      LOCKED: "Too many attempts. Try again in 15 minutes, or reset your password.",
      SUSPENDED: "This account is suspended. Contact support.",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import * as password from "@/server/auth/password";
import { LOGIN_ERROR_COPY, lockedCopy, login, loginErrorCopy } from "@/server/auth/login";
import { trustDevice, verifySignInCode, sendSignInCode } from "@/server/auth/signin-code";
import { createSession, getSession } from "@/server/auth/session";
import { checkTotpForSession, startTotpEnrollment } from "@/server/auth/totp";
import { sendEmail } from "@/server/email/port";
import { windowStartSql } from "@/server/rate-limit";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));
vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

const GOOD = "abcdefg1";
const BAD = "wrong-pass1";
// The attacker's network and the owner's network.
const ATTACKER = { ip: "203.0.113.7" };
const OWNER = { ip: "192.0.2.44" };

let passwordHash: string;

let agencies = 0;
async function createAgency(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  agencies++;
  return db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: `APL-000${agencies}`, status },
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
    vi.mocked(sendEmail).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function hammer(email: string, times: number, ctx: { ip: string } = ATTACKER) {
    const results = [];
    for (let i = 0; i < times; i++) results.push(await login(email, BAD, ctx));
    return results;
  }

  it("correct password → ok, agent does not need TOTP", async () => {
    const agent = await createAgent();
    expect(await login("agent@example.com", GOOD, OWNER)).toEqual({
      ok: true,
      userId: agent.id,
      needsTotp: false,
      trustedDevice: false,
    });
  });

  it("normalizes the email before lookup", async () => {
    const agent = await createAgent();
    expect(await login("  Agent@Example.COM ", GOOD, OWNER)).toMatchObject({ ok: true, userId: agent.id });
  });

  it("admin with correct password → needsTotp true", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    expect(await login("admin@example.com", GOOD, OWNER)).toMatchObject({ ok: true, userId: admin.id, needsTotp: true });
  });

  it("3 wrong passwords from one network → the third pauses that network, one alert; the account itself is not locked", async () => {
    const agent = await createAgent();
    const results = await hammer(agent.email, 3);
    expect(results.slice(0, 2)).toEqual([{ ok: false, reason: "INVALID" }, { ok: false, reason: "INVALID" }]);
    expect(results[2]).toMatchObject({ ok: false, reason: "LOCKED" });

    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyAdminLockout).mock.calls[0]?.[0]).toMatchObject({ id: agent.id, email: agent.email, step: "password" });
    const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
    expect(row.lockedUntil).toBeNull();
    expect(row.failedLogins).toBe(0);
  });

  it("a paused network: even the correct password from there is refused unchecked, and more tries are not alerted again", async () => {
    const agent = await createAgent();
    await hammer(agent.email, 3);
    const verify = vi.spyOn(password, "verifyPassword");
    expect(await login(agent.email, GOOD, ATTACKER)).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(verify).not.toHaveBeenCalled();
    await hammer(agent.email, 5);
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
  });

  it("an attacker who hammers wrong passwords cannot stop the agent: right password from another network, then the email code", async () => {
    const agent = await createAgent();
    await hammer(agent.email, 12);
    const result = await login(agent.email, GOOD, OWNER);
    expect(result).toMatchObject({ ok: true, userId: agent.id, needsTotp: false });

    const session = await getSession(await createSession(agent.id, { verified: false }));
    expect(await sendSignInCode(session!.sessionId)).toBe("sent");
    const code = /code is (\d{6})/.exec(vi.mocked(sendEmail).mock.calls[0]![0].text)![1]!;
    expect(await verifySignInCode(session!.sessionId, code)).toBe("ok");
  });

  it("a spread-out attack fills the account pool: a new browser is refused, the owner's remembered browser still signs in", async () => {
    const agent = await createAgent();
    const deviceToken = await trustDevice(agent.id);
    for (let n = 0; n < 10; n++) await hammer(agent.email, 2, { ip: `198.51.100.${n}` });
    // 20 wrong passwords this hour on this email: any other browser waits.
    expect(await login(agent.email, GOOD, OWNER)).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await login(agent.email, GOOD, { ...OWNER, deviceToken })).toMatchObject({ ok: true, trustedDevice: true });
  });

  it("the only admin cannot be kept out: right password on the remembered browser, then the authenticator code", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    const secret = new URL((await startTotpEnrollment(admin.id)).otpauthUrl).searchParams.get("secret")!;
    await db.user.update({ where: { id: admin.id }, data: { totpConfirmedAt: new Date() } });
    const deviceToken = await trustDevice(admin.id);
    for (let n = 0; n < 30; n++) await hammer(admin.email, 3, { ip: `198.51.100.${n}` });

    // Same network as the attacker, even: the remembered browser has its own pool.
    expect(await login(admin.email, GOOD, { ...ATTACKER, deviceToken })).toMatchObject({ ok: true, needsTotp: true });
    const session = await getSession(await createSession(admin.id, { verified: true }));
    const { generate } = await import("otplib");
    const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
    expect(await checkTotpForSession(session!.sessionId, code)).toBe("OK");
  });

  it("a device cookie of another user does not open a separate pool", async () => {
    const agent = await createAgent();
    const other = await createAgent("other@example.com");
    const deviceToken = await trustDevice(other.id);
    await hammer(agent.email, 3);
    expect(await login(agent.email, GOOD, { ...ATTACKER, deviceToken })).toMatchObject({ ok: false, reason: "LOCKED" });
  });

  it("unknown email and real email get the same answers in the same order, both with one password check per try", async () => {
    const agent = await createAgent();
    const verify = vi.spyOn(password, "verifyPassword");
    const real = await hammer(agent.email, 4);
    const unknown = await hammer("nobody@example.com", 4);
    const reasons = (rs: typeof real) => rs.map((r) => (r.ok ? "ok" : r.reason));
    expect(reasons(unknown)).toEqual(reasons(real));
    expect(reasons(real)).toEqual(["INVALID", "INVALID", "LOCKED", "LOCKED"]);
    // 3 checks each (the 4th is refused unchecked for both); the unknown address against a dummy hash.
    expect(verify).toHaveBeenCalledTimes(6);
    expect(verify).toHaveBeenCalledWith(password.DUMMY_PASSWORD_HASH, BAD);
    // Same copy shown for both.
    expect(real.map((r) => !r.ok && loginErrorCopy(r)).map((c) => (c as string).replace(/\d+ (minute|hour)s?/, "N")))
      .toEqual(unknown.map((r) => !r.ok && loginErrorCopy(r)).map((c) => (c as string).replace(/\d+ (minute|hour)s?/, "N")));
  });

  it("user without a password yet → INVALID with a dummy hash check, paused like any other address", async () => {
    await createUser({ email: "new@example.com", name: "New", role: "ADMIN" });
    const verify = vi.spyOn(password, "verifyPassword");
    const results = await hammer("new@example.com", 3);
    expect(results.map((r) => (r.ok ? "ok" : r.reason))).toEqual(["INVALID", "INVALID", "LOCKED"]);
    expect(verify).toHaveBeenCalledWith(password.DUMMY_PASSWORD_HASH, BAD);
  });

  it("the counter decays: wrong passwords of an earlier window do not count", async () => {
    const agent = await createAgent();
    await hammer(agent.email, 3);
    // Move the counts into the previous windows, as if the time had passed.
    await db.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = ${windowStartSql(15 * 60_000, -1)} WHERE "key" LIKE ${"signin:pw:net:%:15m"}`;
    expect(await login(agent.email, GOOD, ATTACKER)).toMatchObject({ ok: true });
  });

  it("guessing slows down: after 10 wrong passwords in a day from one network, it stays paused even in a new 15-minute window", async () => {
    const agent = await createAgent();
    for (let round = 0; round < 4; round++) {
      await hammer(agent.email, 3);
      await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE ${"signin:pw:net:%:15m"}`;
    }
    // 12 tries were made, 10 counted by the daily pool.
    expect(await login(agent.email, GOOD, ATTACKER)).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await login(agent.email, GOOD, OWNER)).toMatchObject({ ok: true });
  });

  it("alerts at most once an hour per account", async () => {
    const agent = await createAgent();
    await hammer(agent.email, 3);
    await hammer(agent.email, 3, { ip: "198.51.100.1" });
    await hammer(agent.email, 3, { ip: "198.51.100.2" });
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    const other = await createAgent("other@example.com");
    await hammer(other.email, 3);
    expect(notifyAdminLockout).toHaveBeenCalledTimes(2);
  });

  it("unknown addresses never alert", async () => {
    await hammer("nobody@example.com", 5);
    expect(notifyAdminLockout).not.toHaveBeenCalled();
  });

  it("a right password gives its slots back: wrong, right, wrong, wrong does not pause", async () => {
    const agent = await createAgent();
    expect(await login(agent.email, BAD, OWNER)).toMatchObject({ reason: "INVALID" });
    expect(await login(agent.email, GOOD, OWNER)).toMatchObject({ ok: true });
    expect(await login(agent.email, BAD, OWNER)).toMatchObject({ reason: "INVALID" });
    expect(await login(agent.email, GOOD, OWNER)).toMatchObject({ ok: true });
  });

  it("the password step never touches the second-step lock: a locked code step does not refuse the password", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    expect(await login(agent.email, GOOD, OWNER)).toMatchObject({ ok: true });
  });

  it("suspended user with right password → SUSPENDED", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, GOOD, OWNER)).toEqual({ ok: false, reason: "SUSPENDED" });
  });

  it("suspended user with wrong password → INVALID (suspension not revealed)", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, BAD, OWNER)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("agent of a suspended agency with right password → SUSPENDED", async () => {
    const agent = await createAgent();
    await db.agency.update({ where: { id: agent.agencyId! }, data: { status: "SUSPENDED" } });
    expect(await login(agent.email, GOOD, OWNER)).toEqual({ ok: false, reason: "SUSPENDED" });
  });

  it("concurrent wrong passwords alert the admin exactly once", async () => {
    const agent = await createAgent();
    await hammer(agent.email, 2);
    const results = await Promise.all([login(agent.email, BAD, ATTACKER), login(agent.email, BAD, ATTACKER)]);
    expect(results.every((r) => !r.ok && r.reason === "LOCKED")).toBe(true);
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
  });

  it("a failing lockout alert still pauses guessing", async () => {
    vi.mocked(notifyAdminLockout).mockRejectedValueOnce(new Error("mail down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = await createAgent();
    await hammer(agent.email, 2);
    expect(await login(agent.email, BAD, ATTACKER)).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await login(agent.email, GOOD, ATTACKER)).toMatchObject({ ok: false, reason: "LOCKED" });
  });

  it("exact copy for each failure reason; the wait is named, and a reset is offered to every account", () => {
    expect(LOGIN_ERROR_COPY).toEqual({
      INVALID: "Wrong email or password.",
      LOCKED: "Too many attempts. Try again in 15 minutes, or reset your password with Forgot password.",
      SUSPENDED: "This account is suspended. Contact support.",
    });
    expect(lockedCopy(14 * 60_000 + 1)).toBe("Too many attempts. Try again in 15 minutes, or reset your password with Forgot password.");
    expect(lockedCopy(30_000)).toBe("Too many attempts. Try again in 1 minute, or reset your password with Forgot password.");
    expect(lockedCopy(5 * 60 * 60_000)).toBe("Too many attempts. Try again in 5 hours, or reset your password with Forgot password.");
  });
});

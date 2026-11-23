import { generate } from "otplib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { hashPassword } from "@/server/auth/password";
import { login } from "@/server/auth/login";
import { createSession, getSession } from "@/server/auth/session";
import { checkTotpForSession, startTotpEnrollment } from "@/server/auth/totp";
import { unlockUser } from "@/server/auth/unlock";
import { trustDevice } from "@/server/auth/signin-code";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const GOOD = "abcdefg1";
const BAD = "wrong-pass1";
const FIFTEEN_MIN = 15 * 60 * 1000;
const CTX = { ip: "203.0.113.7" };

let passwordHash: string;

async function adminWithTotp(email = "admin@example.com") {
  const admin = await createUser({ email, name: "Admin", role: "ADMIN", passwordHash });
  const url = new URL((await startTotpEnrollment(admin.id)).otpauthUrl);
  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("no secret");
  await db.user.update({ where: { id: admin.id }, data: { totpConfirmedAt: new Date() } });
  return { admin, secret };
}

const auditRows = () => db.auditLog.findMany({ where: { action: "user.unlock" } });

describe("unlockUser", () => {
  beforeEach(async () => {
    passwordHash ??= await hashPassword(GOOD);
    await resetTestDb();
    vi.mocked(notifyAdminLockout).mockClear();
  });

  it("unlocks an admin whose password attempts are paused on a network; the next correct password + TOTP code signs in there", async () => {
    const { admin, secret } = await adminWithTotp();
    await login(admin.email, BAD, CTX);
    await login(admin.email, BAD, CTX);
    expect(await login(admin.email, BAD, CTX)).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await login(admin.email, GOOD, CTX)).toMatchObject({ ok: false, reason: "LOCKED" });
    const before = await db.user.findUniqueOrThrow({ where: { id: admin.id } });

    expect(await unlockUser("  Admin@Example.COM ")).toBe("UNLOCKED");

    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(row).toMatchObject({ failedLogins: 0, lockedUntil: null, attemptReservedAt: null });
    // Password, TOTP and sessions are untouched.
    expect(row.passwordHash).toBe(before.passwordHash);
    expect(row.totpSecret).toBe(secret);
    expect(row.totpConfirmedAt).not.toBeNull();
    expect((await auditRows())[0]?.before).toEqual({ failedLogins: 0, passwordsPaused: true, locked: false });

    expect(await login(admin.email, GOOD, CTX)).toMatchObject({ ok: true, userId: admin.id, needsTotp: true });
    const session = await getSession(await createSession(admin.id, { verified: true }));
    if (!session) throw new Error("no session");
    expect(await checkTotpForSession(session.sessionId, await generate({ secret }))).toBe("OK");
  });

  it("also clears the pool of the owner's remembered browser", async () => {
    const { admin } = await adminWithTotp();
    const deviceToken = await trustDevice(admin.id);
    for (let i = 0; i < 3; i++) await login(admin.email, BAD, { ...CTX, deviceToken });
    expect(await login(admin.email, GOOD, { ...CTX, deviceToken })).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await unlockUser(admin.email)).toBe("UNLOCKED");
    expect(await login(admin.email, GOOD, { ...CTX, deviceToken })).toMatchObject({ ok: true, trustedDevice: true });
  });

  it("unlocks an admin whose authenticator codes are locked", async () => {
    const { admin } = await adminWithTotp();
    await db.user.update({ where: { id: admin.id }, data: { lockedUntil: new Date(Date.now() + FIFTEEN_MIN) } });
    expect(await unlockUser(admin.email)).toBe("UNLOCKED");
    expect(await db.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ lockedUntil: null });
  });

  it("unlocks a stuck row at 3 with no lock", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", role: "ADMIN", passwordHash });
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 3, attemptReservedAt: new Date() },
    });
    expect(await unlockUser("a@example.com")).toBe("UNLOCKED");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      failedLogins: 0,
      lockedUntil: null,
      attemptReservedAt: null,
    });
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.before).toEqual({ failedLogins: 3, passwordsPaused: false, locked: false });
  });

  it("writes an audit row: actor = the unlocked user, no secrets", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", role: "ADMIN", passwordHash });
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 1, lockedUntil: new Date(Date.now() + FIFTEEN_MIN) },
    });
    expect(await unlockUser("a@example.com")).toBe("UNLOCKED");
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: user.id,
      action: "user.unlock",
      targetType: "User",
      targetId: user.id,
      before: { failedLogins: 1, passwordsPaused: false, locked: true },
      after: { via: "owner-command" },
    });
  });

  it("a not-locked user → NOT_LOCKED, no write, no audit row", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", role: "ADMIN", passwordHash });
    const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await unlockUser("a@example.com")).toBe("NOT_LOCKED");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("a user who signed in successfully once (reservation timestamp left behind) → NOT_LOCKED, no write, no audit row", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", role: "ADMIN", passwordHash });
    expect(await login(user.email, GOOD, CTX)).toMatchObject({ ok: true });
    await db.user.update({ where: { id: user.id }, data: { attemptReservedAt: new Date() } });
    const before = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.attemptReservedAt).not.toBeNull();
    expect(before.failedLogins).toBe(0);

    expect(await unlockUser("a@example.com")).toBe("NOT_LOCKED");
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
    expect(await db.auditLog.count({ where: { action: "user.unlock" } })).toBe(0);
  });

  it("an expired lock with no failures and no reservation counts as not locked", async () => {
    const user = await createUser({ email: "a@example.com", name: "A", role: "ADMIN", passwordHash });
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect(await unlockUser("a@example.com")).toBe("NOT_LOCKED");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("an unknown email → NOT_FOUND, no audit row", async () => {
    expect(await unlockUser("nobody@example.com")).toBe("NOT_FOUND");
    expect(await db.auditLog.count()).toBe(0);
  });
});

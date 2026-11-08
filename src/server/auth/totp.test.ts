import { generate } from "otplib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { createSession, getSession } from "@/server/auth/session";
import {
  checkTotpForSession,
  confirmTotp,
  confirmTotpForSession,
  startTotpEnrollment,
  verifyTotpForSession,
} from "@/server/auth/totp";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const nowSeconds = () => Math.floor(Date.now() / 1000);

function codeAt(secret: string, epoch: number): Promise<string> {
  return generate({ secret, epoch });
}

function validCode(secret: string): Promise<string> {
  return codeAt(secret, nowSeconds());
}

// A 6-digit code that does not match any step in the accepted window (previous, current, next).
async function wrongCode(secret: string): Promise<string> {
  const now = nowSeconds();
  const window = new Set(
    await Promise.all([-60, -30, 0, 30, 60].map((offset) => codeAt(secret, now + offset))),
  );
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, "0");
    if (!window.has(candidate)) return candidate;
  }
}

function secretOf(otpauthUrl: string): string {
  const secret = new URL(otpauthUrl).searchParams.get("secret");
  if (!secret) throw new Error("no secret in otpauth URL");
  return secret;
}

async function createAdmin(email = "admin@example.com") {
  return createUser({ email, name: "Admin", role: "ADMIN" });
}

async function sessionIdFor(userId: string): Promise<string> {
  const session = await getSession(await createSession(userId));
  if (!session) throw new Error("no session");
  return session.sessionId;
}

// An admin who finished enrollment, with a fresh (unverified) session.
async function confirmedAdmin() {
  const admin = await createAdmin();
  const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
  // Mark confirmed directly, so no time step is used up before the test runs.
  await db.user.update({ where: { id: admin.id }, data: { totpConfirmedAt: new Date() } });
  const sessionId = await sessionIdFor(admin.id);
  return { admin, secret, sessionId };
}

async function verifiedAt(sessionId: string): Promise<Date | null> {
  return (await db.session.findUniqueOrThrow({ where: { id: sessionId } })).totpVerifiedAt;
}

describe("admin TOTP", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(notifyAdminLockout).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("startTotpEnrollment", () => {
    it("stores a ≥160-bit base32 secret and returns an otpauth URL for issuer Apolles and the admin email", async () => {
      const admin = await createAdmin();
      const { otpauthUrl } = await startTotpEnrollment(admin.id);

      const url = new URL(otpauthUrl);
      expect(url.protocol).toBe("otpauth:");
      expect(url.host).toBe("totp");
      expect(decodeURIComponent(url.pathname)).toBe("/Apolles:admin@example.com");
      expect(url.searchParams.get("issuer")).toBe("Apolles");
      const secret = secretOf(otpauthUrl);
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(secret.length * 5).toBeGreaterThanOrEqual(160);

      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.totpSecret).toBe(secret);
      expect(row.totpConfirmedAt).toBeNull();
    });

    it("calling it again before confirmation replaces the secret", async () => {
      const admin = await createAdmin();
      const first = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      const second = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      expect(second).not.toBe(first);
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret).toBe(second);
    });

    it("throws for an admin whose TOTP is already confirmed (secret unchanged)", async () => {
      const { admin, secret } = await confirmedAdmin();
      await expect(startTotpEnrollment(admin.id)).rejects.toThrow();
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret).toBe(secret);
    });

    it("throws for an agent", async () => {
      const agency = await db.agency.create({
        data: { name: "Agency", country: "IL", bankReference: "APL-0001" },
      });
      const agent = await createUser({ email: "a@example.com", name: "A", role: "AGENT", agencyId: agency.id });
      await expect(startTotpEnrollment(agent.id)).rejects.toThrow();
      expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).totpSecret).toBeNull();
    });
  });

  describe("confirmTotp", () => {
    it("valid code → true, sets totpConfirmedAt and the used step", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      expect(await confirmTotp(admin.id, await validCode(secret))).toBe(true);
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.totpConfirmedAt).not.toBeNull();
      expect(row.totpLastUsedStep).toBe(Math.floor(nowSeconds() / 30));
    });

    it("wrong code → false, not confirmed, counted as a failed sign-in", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      expect(await confirmTotp(admin.id, await wrongCode(secret))).toBe(false);
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.totpConfirmedAt).toBeNull();
      expect(row.failedLogins).toBe(1);
    });

    it("already confirmed → false", async () => {
      const { admin, secret } = await confirmedAdmin();
      expect(await confirmTotp(admin.id, await validCode(secret))).toBe(false);
    });

    it("the code used to confirm cannot be used again to verify a session", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      const code = await validCode(secret);
      expect(await confirmTotp(admin.id, code)).toBe(true);
      const sessionId = await sessionIdFor(admin.id);
      expect(await verifyTotpForSession(sessionId, code)).toBe(false);
      expect(await verifiedAt(sessionId)).toBeNull();
    });
  });

  describe("confirmTotpForSession", () => {
    it("valid code → OK, confirms TOTP and marks this session verified", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      const sessionId = await sessionIdFor(admin.id);
      expect(await confirmTotpForSession(sessionId, await validCode(secret))).toBe("OK");
      expect(await verifiedAt(sessionId)).not.toBeNull();
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpConfirmedAt).not.toBeNull();
    });

    it("wrong code → WRONG, nothing confirmed or verified", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      const sessionId = await sessionIdFor(admin.id);
      expect(await confirmTotpForSession(sessionId, await wrongCode(secret))).toBe("WRONG");
      expect(await verifiedAt(sessionId)).toBeNull();
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpConfirmedAt).toBeNull();
    });
  });

  describe("verifyTotpForSession", () => {
    it("wrong code → false and session stays unverified", async () => {
      const { secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession(sessionId, await wrongCode(secret))).toBe(false);
      expect(await verifiedAt(sessionId)).toBeNull();
    });

    it("valid code (otplib generated) → true", async () => {
      const { secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession(sessionId, await validCode(secret))).toBe(true);
      expect(await verifiedAt(sessionId)).not.toBeNull();
    });

    it("accepts a code from the previous time step (±1 step window)", async () => {
      const { secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession(sessionId, await codeAt(secret, nowSeconds() - 30))).toBe(true);
    });

    it("rejects a code two time steps old", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-08T10:00:15Z"));
      const { secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession(sessionId, await codeAt(secret, nowSeconds() - 60))).toBe(false);
      expect(await verifiedAt(sessionId)).toBeNull();
    });

    it("replayed code → false (a code works once)", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const code = await validCode(secret);
      expect(await verifyTotpForSession(sessionId, code)).toBe(true);

      const second = await sessionIdFor(admin.id);
      expect(await verifyTotpForSession(second, code)).toBe(false);
      expect(await verifiedAt(second)).toBeNull();
      // A replay is refused, but it is not a wrong code: it does not count toward the lock.
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(0);
    });

    it("a code for a later step still works after one was used", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession(sessionId, await validCode(secret))).toBe(true);
      const second = await sessionIdFor(admin.id);
      expect(await verifyTotpForSession(second, await codeAt(secret, nowSeconds() + 30))).toBe(true);
    });

    it("two parallel uses of one code → exactly one true", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const other = await sessionIdFor(admin.id);
      const code = await validCode(secret);
      const results = await Promise.all([
        verifyTotpForSession(sessionId, code),
        verifyTotpForSession(other, code),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const verified = await db.session.count({ where: { totpVerifiedAt: { not: null } } });
      expect(verified).toBe(1);
    });

    it("3 wrong codes → user locked, notifyAdminLockout once, all sessions deleted", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const otherDevice = await sessionIdFor(admin.id);
      await db.session.update({ where: { id: otherDevice }, data: { totpVerifiedAt: new Date() } });
      const bad = await wrongCode(secret);

      expect(await checkTotpForSession(sessionId, bad)).toBe("WRONG");
      expect(await checkTotpForSession(sessionId, bad)).toBe("WRONG");
      expect(await checkTotpForSession(sessionId, bad)).toBe("LOCKED");

      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(row.failedLogins).toBe(0);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(vi.mocked(notifyAdminLockout).mock.calls[0]?.[0]).toMatchObject({
        id: admin.id,
        email: admin.email,
      });
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
    });

    it("wrong TOTP codes and wrong passwords share one counter", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      await db.user.update({ where: { id: admin.id }, data: { failedLogins: 2 } });
      expect(await checkTotpForSession(sessionId, await wrongCode(secret))).toBe("LOCKED");
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    });

    it("locked user with a valid code → false, still unverified, lock not lifted", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await db.user.update({ where: { id: admin.id }, data: { lockedUntil } });

      expect(await verifyTotpForSession(sessionId, await validCode(secret))).toBe(false);
      expect(await checkTotpForSession(sessionId, await validCode(secret))).toBe("LOCKED");
      expect(await verifiedAt(sessionId)).toBeNull();
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.lockedUntil?.getTime()).toBe(lockedUntil.getTime());
      expect(row.totpLastUsedStep).toBeNull();
    });

    it("a correct code resets the failed-attempt counter", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const bad = await wrongCode(secret);
      await verifyTotpForSession(sessionId, bad);
      await verifyTotpForSession(sessionId, bad);
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(2);

      expect(await verifyTotpForSession(sessionId, await validCode(secret))).toBe(true);
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(0);
    });

    it("admin who has not confirmed TOTP → false, not counted", async () => {
      const admin = await createAdmin();
      const secret = secretOf((await startTotpEnrollment(admin.id)).otpauthUrl);
      const sessionId = await sessionIdFor(admin.id);
      expect(await checkTotpForSession(sessionId, await validCode(secret))).toBe("UNAVAILABLE");
      expect(await verifiedAt(sessionId)).toBeNull();
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(0);
    });

    it("expired or unknown session → false", async () => {
      const { secret, sessionId } = await confirmedAdmin();
      expect(await verifyTotpForSession("no-such-session", await validCode(secret))).toBe(false);
      await db.session.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await verifyTotpForSession(sessionId, await validCode(secret))).toBe(false);
      expect(await verifiedAt(sessionId)).toBeNull();
    });

    it("malformed code (not exactly 6 digits) → false, not counted", async () => {
      const { admin, sessionId } = await confirmedAdmin();
      for (const junk of ["", "12345", "1234567", "12a456", " 123456"]) {
        expect(await verifyTotpForSession(sessionId, junk)).toBe(false);
      }
      expect(await verifiedAt(sessionId)).toBeNull();
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(0);
    });
  });
});

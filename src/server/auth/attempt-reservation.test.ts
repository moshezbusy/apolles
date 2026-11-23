import { generate, verify } from "otplib";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import * as password from "@/server/auth/password";
import { audit } from "@/server/audit";
import { createSession, getSession } from "@/server/auth/session";
import { login, type LoginResult } from "@/server/auth/login";
import {
  checkTotpForSession,
  confirmTotpForSession,
  startTotpEnrollment,
  type TotpCheckResult,
} from "@/server/auth/totp";

// H1 (differential review): a sign-in attempt must take an attempt slot BEFORE the password
// or code is checked. Requests that find no slot left are refused without any check, so a
// burst of parallel guesses can never check more secrets than the slots allow: 3 codes per
// lock window (second step), 3 passwords per network per window and 20 per account per hour
// (password step, lockout-policy.ts).
//
// These tests are deterministic, not timing-based: the checker (argon2 / TOTP verify) is
// replaced by a gate that holds every call until each request in the burst has either
// reached the checker or finished. Requests that got a slot wait in the checker; requests
// that got none finish at once. So the gate always opens, with or without the fix, and the
// number of checks made is exact.

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));
// The real audit() runs; a test can make one call fail (a DB error inside the TOTP claim).
vi.mock("@/server/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/audit")>();
  return { audit: vi.fn(actual.audit) };
});
vi.mock("otplib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("otplib")>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

const GOOD = "abcdefg1";
const BAD = "wrong-pass1";

let realVerify: typeof verify;
let passwordHash: string;

beforeAll(async () => {
  realVerify = (await vi.importActual<typeof import("otplib")>("otplib")).verify;
  passwordHash = await password.hashPassword(GOOD);
});

// Opens once `total` requests are each inside the checker or finished.
function createGate(total: number) {
  let inside = 0;
  let finished = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const check = () => {
    if (inside + finished >= total) open();
  };
  return {
    async enter(): Promise<void> {
      inside++;
      check();
      await opened;
    },
    track<T>(request: Promise<T>): Promise<T> {
      return request.finally(() => {
        finished++;
        check();
      });
    },
  };
}

// Holds only the first call of the checker until release(); later calls pass straight through.
function createHold() {
  let entered!: () => void;
  let release!: () => void;
  const enteredP = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releaseP = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  return {
    entered: enteredP,
    release,
    async enter(): Promise<void> {
      if (!first) return;
      first = false;
      entered();
      await releaseP;
    },
  };
}

async function userRow(id: string) {
  return db.user.findUniqueOrThrow({ where: { id } });
}

function isLockedNow(lockedUntil: Date | null): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > Date.now();
}

describe("attempt slot reserved before the secret is checked", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(notifyAdminLockout).mockClear();
    vi.mocked(verify).mockClear();
    vi.mocked(verify).mockImplementation((options) => realVerify(options));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("admin TOTP step", () => {
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    async function wrongCodeFor(secret: string): Promise<string> {
      const now = nowSeconds();
      const window = new Set(
        await Promise.all([-60, -30, 0, 30, 60].map((offset) => generate({ secret, epoch: now + offset }))),
      );
      for (let n = 0; ; n++) {
        const candidate = String(n).padStart(6, "0");
        if (!window.has(candidate)) return candidate;
      }
    }

    async function confirmedAdmin(failedLogins = 0) {
      const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
      const url = new URL((await startTotpEnrollment(admin.id)).otpauthUrl);
      const secret = url.searchParams.get("secret") ?? "";
      await db.user.update({ where: { id: admin.id }, data: { totpConfirmedAt: new Date(), failedLogins } });
      const session = await getSession(await createSession(admin.id, { verified: true }));
      if (!session) throw new Error("no session");
      return { admin, secret, sessionId: session.sessionId };
    }

    // Every TOTP check records the code it was given, then waits at the gate.
    function gateVerify(gate: { enter(): Promise<void> }): string[] {
      const checked: string[] = [];
      vi.mocked(verify).mockImplementation(async (options) => {
        checked.push(options.token);
        await gate.enter();
        return realVerify(options);
      });
      return checked;
    }

    it("19 wrong codes and 1 correct code in parallel: exactly 3 codes are checked; the correct one is accepted only if it was one of them", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const bad = await wrongCodeFor(secret);
      const good = await generate({ secret, epoch: nowSeconds() });
      const gate = createGate(20);
      const checked = gateVerify(gate);

      const codes = [...Array.from({ length: 19 }, () => bad), good];
      const results = await Promise.all(codes.map((code) => gate.track(checkTotpForSession(sessionId, code))));

      expect(checked).toHaveLength(3);
      const goodResult = results[19];
      if (goodResult === "OK") {
        expect(checked).toContain(good);
        expect(results.filter((r) => r === "OK")).toHaveLength(1);
        expect(await db.session.count({ where: { id: sessionId, totpVerifiedAt: { not: null } } })).toBe(1);
      } else {
        // The 3 slots went to wrong codes (or a wrong one locked the account first).
        expect(goodResult).toBe("LOCKED");
        expect(results.every((r) => r !== "OK")).toBe(true);
        const row = await userRow(admin.id);
        expect(isLockedNow(row.lockedUntil)).toBe(true);
        expect(row.failedLogins).toBe(0);
        expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
        expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
      }
    });

    it("20 parallel wrong codes: exactly 3 are checked, one lock, one alert, every session ended", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin();
      const bad = await wrongCodeFor(secret);
      const gate = createGate(20);
      const checked = gateVerify(gate);

      const results = await Promise.all(
        Array.from({ length: 20 }, () => gate.track(checkTotpForSession(sessionId, bad))),
      );

      expect(checked).toHaveLength(3);
      expect(results.filter((r) => r === "LOCKED").length).toBeGreaterThanOrEqual(18);
      expect(results.every((r: TotpCheckResult) => r === "WRONG" || r === "LOCKED")).toBe(true);
      const row = await userRow(admin.id);
      expect(isLockedNow(row.lockedUntil)).toBe(true);
      expect(row.failedLogins).toBe(0);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
    });

    it("2 strikes already: 10 parallel requests with the correct code → exactly one is checked and accepted, the rest are refused unchecked", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin(2);
      const good = await generate({ secret, epoch: nowSeconds() });
      const gate = createGate(10);
      const checked = gateVerify(gate);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => gate.track(checkTotpForSession(sessionId, good))),
      );

      expect(checked).toHaveLength(1);
      expect(results.filter((r) => r === "OK")).toHaveLength(1);
      expect(results.filter((r) => r === "LOCKED")).toHaveLength(9);
      const row = await userRow(admin.id);
      expect(row.failedLogins).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(notifyAdminLockout).not.toHaveBeenCalled();
    });

    it("2 strikes already, a wrong code holds the last slot: a correct code sent meanwhile is refused unchecked, then the account locks", async () => {
      const { admin, secret, sessionId } = await confirmedAdmin(2);
      const bad = await wrongCodeFor(secret);
      const good = await generate({ secret, epoch: nowSeconds() });
      const hold = createHold();
      const checked = gateVerify(hold);

      const wrong = checkTotpForSession(sessionId, bad);
      await hold.entered;
      expect(await checkTotpForSession(sessionId, good)).toBe("LOCKED");
      expect(checked).toEqual([bad]);
      expect(await db.session.count({ where: { id: sessionId, totpVerifiedAt: { not: null } } })).toBe(0);

      hold.release();
      expect(await wrong).toBe("LOCKED");
      const row = await userRow(admin.id);
      expect(isLockedNow(row.lockedUntil)).toBe(true);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
    });
  });

  describe("password step (login)", () => {
    const CTX = { ip: "203.0.113.7" };

    async function agent() {
      const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
      return createUser({ email: "agent@example.com", name: "Agent", role: "AGENT", agencyId: agency.id, passwordHash });
    }

    // Every password check records the password it was given, then waits at the gate.
    function gatePassword(gate: { enter(): Promise<void> }): string[] {
      const checked: string[] = [];
      vi.spyOn(password, "verifyPassword").mockImplementation(async (_hash, candidate) => {
        checked.push(candidate);
        await gate.enter();
        return candidate === GOOD;
      });
      return checked;
    }

    it("20 parallel wrong passwords from one network: exactly 3 are checked, one alert, the user row is not locked", async () => {
      const user = await agent();
      const gate = createGate(20);
      const checked = gatePassword(gate);

      const results = await Promise.all(Array.from({ length: 20 }, () => gate.track(login(user.email, BAD, CTX))));

      expect(checked).toHaveLength(3);
      expect(results.every((r: LoginResult) => !r.ok)).toBe(true);
      expect(results.filter((r) => !r.ok && r.reason === "LOCKED")).toHaveLength(18);
      const row = await userRow(user.id);
      expect(row.lockedUntil).toBeNull();
      expect(row.failedLogins).toBe(0);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    });

    it("19 wrong passwords and the correct one in parallel: exactly 3 are checked; the correct one signs in only if it was one of them", async () => {
      const user = await agent();
      const gate = createGate(20);
      const checked = gatePassword(gate);

      const candidates = [...Array.from({ length: 19 }, () => BAD), GOOD];
      const results = await Promise.all(candidates.map((p) => gate.track(login(user.email, p, CTX))));

      expect(checked).toHaveLength(3);
      const goodResult = results[19];
      if (goodResult?.ok) {
        expect(checked).toContain(GOOD);
      } else {
        expect(goodResult).toMatchObject({ ok: false, reason: "LOCKED" });
        expect(checked).not.toContain(GOOD);
      }
    });

    it("a spread-out attack: 2 wrong passwords from each of 30 networks in parallel → no more than 20 are checked in the hour", async () => {
      const user = await agent();
      const gate = createGate(60);
      const checked = gatePassword(gate);

      const requests = Array.from({ length: 60 }, (_, i) => gate.track(login(user.email, BAD, { ip: `198.51.100.${i % 30}` })));
      await Promise.all(requests);

      expect(checked).toHaveLength(20);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    });

    it("a wrong password holds the last slot of a network: the correct password sent meanwhile from there is refused unchecked; from another network it signs in", async () => {
      const user = await agent();
      await login(user.email, BAD, CTX);
      await login(user.email, BAD, CTX);
      const hold = createHold();
      const checked = gatePassword(hold);

      const wrong = login(user.email, BAD, CTX);
      await hold.entered;
      expect(await login(user.email, GOOD, CTX)).toMatchObject({ ok: false, reason: "LOCKED" });
      expect(checked).toEqual([BAD]);
      expect(await login(user.email, GOOD, { ip: "192.0.2.44" })).toMatchObject({ ok: true, userId: user.id });

      hold.release();
      expect(await wrong).toMatchObject({ ok: false, reason: "LOCKED" });
    });

    it("an error during the password check reaches the caller and its slots stay used (fail closed)", async () => {
      const user = await agent();
      vi.spyOn(password, "verifyPassword").mockRejectedValue(new Error("argon2 pool down"));
      for (let i = 0; i < 3; i++) await expect(login(user.email, GOOD, CTX)).rejects.toThrow("argon2 pool down");
      // Three slots used by the errors: the next attempt is refused before any check.
      expect(await login(user.email, GOOD, CTX)).toMatchObject({ ok: false, reason: "LOCKED" });
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    });
  });

  // Fix round 2: an error after the slot was reserved must never leave the slot used for
  // good. It counts as a failed attempt, so a used last slot becomes a normal 15-minute lock
  // with one alert (fail closed), and the original error still reaches the caller.
  describe("an error after the slot was reserved", () => {
    const FIFTEEN_MIN = 15 * 60 * 1000;

    function expectTimedLock(lockedUntil: Date | null, before: number, after: number) {
      expect(lockedUntil).not.toBeNull();
      expect(lockedUntil!.getTime()).toBeGreaterThanOrEqual(before + FIFTEEN_MIN);
      expect(lockedUntil!.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN);
    }

    async function totpAdmin({ failedLogins, confirmed }: { failedLogins: number; confirmed: boolean }) {
      const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
      const url = new URL((await startTotpEnrollment(admin.id)).otpauthUrl);
      const secret = url.searchParams.get("secret") ?? "";
      await db.user.update({
        where: { id: admin.id },
        data: { failedLogins, ...(confirmed ? { totpConfirmedAt: new Date() } : {}) },
      });
      const session = await getSession(await createSession(admin.id, { verified: true }));
      if (!session) throw new Error("no session");
      return { admin, secret, sessionId: session.sessionId };
    }

    it("TOTP, slot 3: the code check throws → error, a 15-minute lock, one alert, every session ended", async () => {
      const { admin, sessionId } = await totpAdmin({ failedLogins: 2, confirmed: true });
      vi.mocked(verify).mockRejectedValueOnce(new Error("otp lib failure"));
      const before = Date.now();
      await expect(checkTotpForSession(sessionId, "123456")).rejects.toThrow("otp lib failure");
      const row = await userRow(admin.id);
      expectTimedLock(row.lockedUntil, before, Date.now());
      expect(row.failedLogins).toBe(0);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
    });

    it("TOTP, slot 3: the claim fails with a DB error after a correct code → error, session not verified, timed lock, one alert", async () => {
      const { admin, secret, sessionId } = await totpAdmin({ failedLogins: 2, confirmed: false });
      vi.mocked(audit).mockRejectedValueOnce(new Error("audit insert failed"));
      const before = Date.now();
      const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
      await expect(confirmTotpForSession(sessionId, code)).rejects.toThrow("audit insert failed");
      const row = await userRow(admin.id);
      expect(row.totpConfirmedAt).toBeNull();
      expectTimedLock(row.lockedUntil, before, Date.now());
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(await db.session.count({ where: { userId: admin.id, totpVerifiedAt: { not: null } } })).toBe(0);
    });
  });

  // R48: a request that died between taking a slot and giving it back (process crash, deploy
  // restart) can leave the row at MAX_FAILED_LOGINS with no lock. Once the last reservation is
  // older than STUCK_RESERVATION_MS, the next attempt turns it into a normal 15-minute lock:
  // one alert, every session ended, LOCKED. A fresh reservation (slot 3 still in flight) is
  // left alone, as before.
  describe("a slot left used by a crashed request", () => {
    const FIFTEEN_MIN = 15 * 60 * 1000;
    const THREE_MIN = 3 * 60 * 1000;

    // Fake only Date, starting at the real time: the reservation time comes from the
    // database clock, which the fake timers cannot move.
    function fakeDateFromNow(): number {
      const start = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      return start;
    }

    async function stuckAdmin(attemptReservedAt: Date | null) {
      const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
      const url = new URL((await startTotpEnrollment(admin.id)).otpauthUrl);
      const secret = url.searchParams.get("secret") ?? "";
      await db.user.update({
        where: { id: admin.id },
        data: { totpConfirmedAt: new Date(), failedLogins: 3, lockedUntil: null, attemptReservedAt },
      });
      const session = await getSession(await createSession(admin.id, { verified: true }));
      if (!session) throw new Error("no session");
      return { admin, secret, sessionId: session.sessionId };
    }

    it("TOTP, stuck at 3 with an old reservation → LOCKED unchecked, a 15-minute lock, one alert, every session ended; a code works after 15 minutes", async () => {
      const start = fakeDateFromNow();
      const { admin, secret, sessionId } = await stuckAdmin(new Date(start - THREE_MIN));
      const otherDevice = await createSession(admin.id, { verified: true });
      await db.session.updateMany({ where: { userId: admin.id }, data: { totpVerifiedAt: new Date() } });
      vi.mocked(verify).mockClear();

      const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
      expect(await checkTotpForSession(sessionId, code)).toBe("LOCKED");
      expect(verify).not.toHaveBeenCalled();
      const row = await userRow(admin.id);
      expect(row.lockedUntil?.getTime()).toBe(start + FIFTEEN_MIN);
      expect(row.failedLogins).toBe(0);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
      expect(await getSession(otherDevice)).toBeNull();

      vi.setSystemTime(start + FIFTEEN_MIN);
      const fresh = await getSession(await createSession(admin.id, { verified: true }));
      const later = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
      expect(await checkTotpForSession(fresh!.sessionId, later)).toBe("OK");
    });

    it("taking a code slot records the database time of the reservation", async () => {
      const { admin, sessionId } = await stuckAdmin(null);
      await db.user.update({ where: { id: admin.id }, data: { failedLogins: 0 } });
      const before = Date.now();
      await checkTotpForSession(sessionId, "000000");
      const reservedAt = (await userRow(admin.id)).attemptReservedAt;
      expect(reservedAt).not.toBeNull();
      // Database clock vs this process's clock: same machine, allow a little skew.
      expect(Math.abs(reservedAt!.getTime() - before)).toBeLessThan(5_000);
    });

    it("parallel code attempts on a stuck row: all LOCKED, exactly one lock and one alert", async () => {
      const { admin, sessionId } = await stuckAdmin(new Date(Date.now() - THREE_MIN));
      const results = await Promise.all(Array.from({ length: 10 }, () => checkTotpForSession(sessionId, "000000")));
      expect(results.every((r) => r === "LOCKED")).toBe(true);
      expect(isLockedNow((await userRow(admin.id)).lockedUntil)).toBe(true);
      expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    });

    it("failures decay: 2 wrong codes, then no attempt for more than 15 minutes → the next wrong code is strike 1, no lock", async () => {
      const { admin, secret, sessionId } = await stuckAdmin(new Date(Date.now() - 16 * 60_000));
      await db.user.update({ where: { id: admin.id }, data: { failedLogins: 2 } });
      const bad = (await generate({ secret, epoch: Math.floor(Date.now() / 1000) })) === "000000" ? "000001" : "000000";
      expect(await checkTotpForSession(sessionId, bad)).toBe("WRONG");
      const row = await userRow(admin.id);
      expect(row.failedLogins).toBe(1);
      expect(row.lockedUntil).toBeNull();
      expect(notifyAdminLockout).not.toHaveBeenCalled();
    });

    it("a full row whose last attempt is older than 15 minutes decays instead of locking: the right code is checked and accepted", async () => {
      const { admin, secret, sessionId } = await stuckAdmin(new Date(Date.now() - 20 * 60_000));
      const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
      expect(await checkTotpForSession(sessionId, code)).toBe("OK");
      expect((await userRow(admin.id)).failedLogins).toBe(0);
      expect(notifyAdminLockout).not.toHaveBeenCalled();
    });

    it("TOTP, at 3 with a fresh reservation → LOCKED, no lock written, no alert, session kept", async () => {
      const { admin, secret, sessionId } = await stuckAdmin(new Date(Date.now() - 10_000));
      const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
      expect(await checkTotpForSession(sessionId, code)).toBe("LOCKED");
      const row = await userRow(admin.id);
      expect(row.lockedUntil).toBeNull();
      expect(row.failedLogins).toBe(3);
      expect(notifyAdminLockout).not.toHaveBeenCalled();
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(1);
    });
  });
});

import { DEVICE_COOKIE, trustDevice } from "@/server/auth/signin-code";
import { generateSecret } from "otplib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, getSession } from "@/server/auth/session";
import { requireAdmin } from "@/server/auth/guards";
import { loginAction } from "@/app/login/actions";
import { RATE_LIMITS } from "@/server/rate-limit";
import { seedRateLimit } from "@/test/rate-limit";
import { DEMO_AGENT_EMAIL } from "@/server/content/demo-seed";

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(requestHeaders)),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      jar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

// Emails go nowhere in these tests; `mailDown` makes the provider fail like a real outage.
let mailDown = false;
const sentEmails: { to: string; subject: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => {
    if (mailDown) throw new Error("Postmark send failed: HTTP 500");
    sentEmails.push(m);
  }),
}));

const GOOD = "abcdefg1";
let passwordHash: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function createAgent() {
  const agency = await db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: "APL-0001" },
  });
  return createUser({ email: "agent@example.com", name: "A", role: "AGENT", agencyId: agency.id, passwordHash });
}

describe("loginAction", () => {
  beforeEach(async () => {
    passwordHash ??= await hashPassword(GOOD);
    await resetTestDb();
    setCalls.length = 0;
    jar.clear();
    requestHeaders.clear();
    requestHeaders.set("x-forwarded-for", "203.0.113.7");
    mailDown = false;
    sentEmails.length = 0;
  });

  describe("sign-in code that cannot be sent", () => {
    it("mail provider down → a clear message, no crash, no cookie and no half-made session left", async () => {
      await createAgent();
      mailDown = true;
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await loginAction(null, form({ email: "agent@example.com", password: GOOD }))).toEqual({
        error: "We could not send the code. Try again in a few minutes.",
      });
      expect(setCalls).toHaveLength(0);
      expect(await db.session.count()).toBe(0);
      logged.mockRestore();
      // The next try, with the provider back, works as usual.
      mailDown = false;
      await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/login/verify");
      expect(sentEmails.map((m) => m.subject)).toEqual(["Your Apolles sign-in code"]);
    });

    it("too many codes this hour → says so on the sign-in form instead of a page that claims a code was sent", async () => {
      const agent = await createAgent();
      await seedRateLimit(`signin-code:${agent.id}`, 6, 60 * 60_000);
      expect(await loginAction(null, form({ email: "agent@example.com", password: GOOD }))).toEqual({
        error: "Too many sign-in codes were sent to this account. Try again in an hour.",
      });
      expect(setCalls).toHaveLength(0);
      expect(await db.session.count()).toBe(0);
      expect(sentEmails).toHaveLength(0);
    });

    it("the session of an earlier sign-in in this browser is still replaced only by a complete new sign-in", async () => {
      const agent = await createAgent();
      jar.set(DEVICE_COOKIE, await trustDevice(agent.id));
      await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/search");
      expect(setCalls).toHaveLength(1);
      expect(await db.session.count()).toBe(1);
    });
  });

  it("agent on a new device → a session waiting for the email code, and /login/verify", async () => {
    const agent = await createAgent();
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    const session = await getSession(setCalls[0]!.value);
    expect(session?.user.id).toBe(agent.id);
    expect(session?.emailVerifiedAt).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: session!.sessionId } })).codeHash).not.toBeNull();
  });

  it("agent success on a known device → sets a secure session cookie and redirects to /search", async () => {
    const agent = await createAgent();
    jar.set(DEVICE_COOKIE, await trustDevice(agent.id));
    await expect(
      loginAction(null, form({ email: "agent@example.com", password: GOOD })),
    ).rejects.toThrow("NEXT_REDIRECT:/search");

    expect(setCalls).toHaveLength(1);
    const call = setCalls[0]!;
    expect(call.name).toBe(SESSION_COOKIE);
    expect(call.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    const session = await getSession(call.value);
    expect(session?.user.id).toBe(agent.id);
  });

  describe("staging demo agent", () => {
    async function createDemoAgent() {
      const agency = await db.agency.create({ data: { name: "Demo", country: "IL", bankReference: "APL-DEMO" } });
      return createUser({ email: DEMO_AGENT_EMAIL, name: "Demo Agent", role: "AGENT", agencyId: agency.id, passwordHash });
    }
    afterEach(() => vi.unstubAllEnvs());

    it("with the demo supplier on → no email code, a verified session and /search", async () => {
      vi.stubEnv("SUPPLIER_MODE", "fake");
      const agent = await createDemoAgent();
      await expect(loginAction(null, form({ email: DEMO_AGENT_EMAIL, password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/search");
      const session = await getSession(setCalls[0]!.value);
      expect(session?.user.id).toBe(agent.id);
      expect(session?.emailVerifiedAt).not.toBeNull();
      expect((await db.session.findUniqueOrThrow({ where: { id: session!.sessionId } })).codeHash).toBeNull();
    });

    it("with the real supplier → the demo agent still gets the email code", async () => {
      vi.stubEnv("SUPPLIER_MODE", "expedia");
      await createDemoAgent();
      await expect(loginAction(null, form({ email: DEMO_AGENT_EMAIL, password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    });

    it("with the demo supplier on → any other agent still gets the email code", async () => {
      vi.stubEnv("SUPPLIER_MODE", "fake");
      await createAgent();
      await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    });

    it("demo supplier asked for in production → the sign-in fails, no code skipped", async () => {
      vi.stubEnv("SUPPLIER_MODE", "fake");
      vi.stubEnv("APP_ENV", "production");
      await createDemoAgent();
      await expect(loginAction(null, form({ email: DEMO_AGENT_EMAIL, password: GOOD }))).rejects.toThrow("only for development");
      expect(await db.session.count({ where: { emailVerifiedAt: { not: null } } })).toBe(0);
    });
  });

  it("known device: the sign-in is complete, so earlier wrong passwords stop counting", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { failedLogins: 2 } });
    jar.set(DEVICE_COOKIE, await trustDevice(agent.id));
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/search");
    expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).failedLogins).toBe(0);
  });

  it("new device: a correct password alone does not clear earlier wrong tries (the code does)", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { failedLogins: 2 } });
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    expect((await db.user.findUniqueOrThrow({ where: { id: agent.id } })).failedLogins).toBe(2);
  });

  it("admin success → redirects to /admin", async () => {
    await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    await expect(
      loginAction(null, form({ email: "admin@example.com", password: GOOD })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
  });

  it("admin who just signed in (TOTP not set up) → requireAdmin sends them to /admin/2fa/setup", async () => {
    await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    await expect(
      loginAction(null, form({ email: "admin@example.com", password: GOOD })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/admin/2fa/setup");
  });

  it("admin who just signed in (TOTP set up) → requireAdmin sends them to /admin/2fa", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash });
    await db.user.update({
      where: { id: admin.id },
      data: { totpSecret: generateSecret(), totpConfirmedAt: new Date() },
    });
    await expect(
      loginAction(null, form({ email: "admin@example.com", password: GOOD })),
    ).rejects.toThrow("NEXT_REDIRECT:/admin");
    await expect(requireAdmin()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
  });

  it("signing in again replaces the previous session from the cookie", async () => {
    await createAgent();
    const fd = () => form({ email: "agent@example.com", password: GOOD });
    await expect(loginAction(null, fd())).rejects.toThrow("NEXT_REDIRECT");
    await expect(loginAction(null, fd())).rejects.toThrow("NEXT_REDIRECT");
    expect(await db.session.count()).toBe(1);
  });

  it("wrong password → exact copy, no cookie", async () => {
    await createAgent();
    expect(await loginAction(null, form({ email: "agent@example.com", password: "nope12345" }))).toEqual({
      error: "Wrong email or password.",
    });
    expect(setCalls).toHaveLength(0);
  });

  it("third wrong password → lockout copy", async () => {
    await createAgent();
    const fd = () => form({ email: "agent@example.com", password: "nope12345" });
    await loginAction(null, fd());
    await loginAction(null, fd());
    expect(await loginAction(null, fd())).toEqual({
      error: "Too many attempts. Try again in 15 minutes, or reset your password.",
    });
  });

  it("suspended → suspended copy", async () => {
    const agent = await createAgent();
    await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
    expect(await loginAction(null, form({ email: "agent@example.com", password: GOOD }))).toEqual({
      error: "This account is suspended. Contact support.",
    });
  });

  it("missing or oversized fields → generic copy, no lookup", async () => {
    await createAgent();
    expect(await loginAction(null, form({ email: "agent@example.com" }))).toEqual({
      error: "Wrong email or password.",
    });
    expect(
      await loginAction(null, form({ email: "agent@example.com", password: "a1".repeat(129) })),
    ).toEqual({ error: "Wrong email or password." });
    // Oversized input was rejected before it reached the lockout counter.
    const row = await db.user.findUniqueOrThrow({ where: { email: "agent@example.com" } });
    expect(row.failedLogins).toBe(0);
  });

  describe("per-IP rate limit (10 per 15 minutes)", () => {
    const TOO_MANY = "Too many sign-in attempts from your network. Try again in 15 minutes.";
    const { limit, windowMs } = RATE_LIMITS.signin;

    it("the 10th sign-in from one IP in the window still goes through", async () => {
      await createAgent();
      await seedRateLimit("signin:ip:203.0.113.7", limit - 1, windowMs);
      await expect(
        loginAction(null, form({ email: "agent@example.com", password: GOOD })),
      ).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    });

    it("the 11th is refused before the password is checked: failedLogins unchanged, no session", async () => {
      const agent = await createAgent();
      await seedRateLimit("signin:ip:203.0.113.7", limit, windowMs);

      expect(await loginAction(null, form({ email: "agent@example.com", password: "nope12345" }))).toEqual({
        error: TOO_MANY,
      });
      expect(await loginAction(null, form({ email: "agent@example.com", password: GOOD }))).toEqual({
        error: TOO_MANY,
      });
      const row = await db.user.findUniqueOrThrow({ where: { id: agent.id } });
      expect(row.failedLogins).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.attemptReservedAt).toBeNull();
      expect(setCalls).toHaveLength(0);
      expect(await db.session.count()).toBe(0);
    });

    it("counts only failed sign-ins, by the client IP the proxy appended: a right password hands its count back", async () => {
      await createAgent();
      // The left entry is chosen by the client; only the right-most one (the proxy's) counts.
      requestHeaders.set("x-forwarded-for", "1.1.1.1, 203.0.113.7");
      await loginAction(null, form({ email: "agent@example.com", password: "nope12345" }));
      await loginAction(null, form({ email: "nobody@example.com", password: "nope12345" }));
      requestHeaders.set("x-forwarded-for", "9.9.9.9, 203.0.113.7");
      await expect(
        loginAction(null, form({ email: "agent@example.com", password: GOOD })),
      ).rejects.toThrow("NEXT_REDIRECT");
      const rows = await db.rateLimitBucket.findMany({ where: { key: { startsWith: "signin:ip:" } } });
      expect(rows.map((r) => [r.key, r.count])).toEqual([["signin:ip:203.0.113.7", 2]]);
    });

    it("an office that signs in many times with right passwords is never limited", async () => {
      const agent = await createAgent();
      jar.set(DEVICE_COOKIE, await trustDevice(agent.id)); // a known device: no email code
      for (let i = 0; i < limit + 2; i++) {
        await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD }))).rejects.toThrow("NEXT_REDIRECT");
      }
      const rows = await db.rateLimitBucket.findMany({ where: { key: { startsWith: "signin:ip:" } } });
      expect(rows.map((r) => r.count)).toEqual([0]);
    });

    it("a suspended or locked account's right password still counts (it is not a sign-in)", async () => {
      const agent = await createAgent();
      await db.user.update({ where: { id: agent.id }, data: { status: "SUSPENDED" } });
      await loginAction(null, form({ email: "agent@example.com", password: GOOD }));
      const rows = await db.rateLimitBucket.findMany({ where: { key: { startsWith: "signin:ip:" } } });
      expect(rows.map((r) => r.count)).toEqual([1]);
    });

    it("IPv6: one /64 network shares the counter", async () => {
      await createAgent();
      requestHeaders.set("x-forwarded-for", "2001:db8:1:2::1");
      await loginAction(null, form({ email: "agent@example.com", password: "nope12345" }));
      requestHeaders.set("x-forwarded-for", "2001:db8:1:2:aaaa::9");
      await loginAction(null, form({ email: "nobody@example.com", password: "nope12345" }));
      const rows = await db.rateLimitBucket.findMany({ where: { key: { startsWith: "signin:ip:" } } });
      expect(rows.map((r) => [r.key, r.count])).toEqual([["signin:ip:2001:db8:1:2::/64", 2]]);
    });

    it("another IP is not affected", async () => {
      await createAgent();
      await seedRateLimit("signin:ip:203.0.113.7", limit, windowMs);
      requestHeaders.set("x-forwarded-for", "198.51.100.20");
      await expect(
        loginAction(null, form({ email: "agent@example.com", password: GOOD })),
      ).rejects.toThrow("NEXT_REDIRECT:/login/verify");
    });
  });
});

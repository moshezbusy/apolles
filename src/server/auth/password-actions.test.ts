import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { sendEmail } from "@/server/email/port";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { issuePasswordToken } from "@/server/auth/password-tokens";
import { requestResetAction } from "@/app/forgot-password/actions";
import { setPasswordAction } from "@/app/set-password/[token]/actions";
import { RATE_LIMITS, emailKey } from "@/server/rate-limit";
import { seedRateLimit } from "@/test/rate-limit";

const requestHeaders = new Map<string, string>([["x-forwarded-for", "203.0.113.7"]]);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(requestHeaders)),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

// `after()` runs its callback once the response is sent. Here it runs it at once and keeps
// the promise so the test can wait for it. With `deferAfter`, it only stores the callback, to
// show what happens before the response.
const pendingAfter: Promise<unknown>[] = [];
const deferredAfter: (() => Promise<unknown>)[] = [];
let deferAfter = false;
vi.mock("next/server", () => ({
  after: vi.fn((task: () => Promise<unknown>) => {
    if (deferAfter) deferredAfter.push(task);
    else pendingAfter.push(task());
  }),
}));

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

const SENT = { sent: true };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function createAdmin() {
  return createUser({
    email: "admin@example.com",
    name: "Admin",
    role: "ADMIN",
    passwordHash: await hashPassword("oldpass12"),
  });
}

describe("requestResetAction (forgot password)", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.mocked(sendEmail).mockReset();
    pendingAfter.length = 0;
    deferredAfter.length = 0;
    deferAfter = false;
    requestHeaders.set("x-forwarded-for", "203.0.113.7");
    await resetTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("known email → same answer, one reset email sent after the response", async () => {
    await createAdmin();
    expect(await requestResetAction(null, form({ email: "admin@example.com" }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("unknown email → same answer, no email", async () => {
    expect(await requestResetAction(null, form({ email: "nobody@example.com" }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("missing or oversized email → same answer, nothing looked up", async () => {
    await createAdmin();
    expect(await requestResetAction(null, form({}))).toEqual(SENT);
    expect(await requestResetAction(null, form({ email: `${"a".repeat(250)}@example.com` }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(pendingAfter).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  describe("rate limits (5 per IP and 3 per email per hour): silently send nothing", () => {
    it("per-email cap: the 4th request for one email sends nothing; same answer", async () => {
      await createAdmin();
      const { limit, windowMs } = RATE_LIMITS.forgotEmail;
      await seedRateLimit(emailKey("admin@example.com"), limit, windowMs);
      expect(await requestResetAction(null, form({ email: "Admin@Example.com " }))).toEqual(SENT);
      await Promise.all(pendingAfter);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(await db.passwordToken.count()).toBe(0);
    });

    it("per-email cap is per email: another email from the same IP is still sent", async () => {
      await createAdmin();
      const { limit, windowMs } = RATE_LIMITS.forgotEmail;
      await seedRateLimit(emailKey("someone-else@example.com"), limit, windowMs);
      expect(await requestResetAction(null, form({ email: "admin@example.com" }))).toEqual(SENT);
      await Promise.all(pendingAfter);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it("3 requests for one email are sent, the 4th is not (real counting, one IP each)", async () => {
      await createAdmin();
      const answers = [];
      for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3", "198.51.100.4"]) {
        requestHeaders.set("x-forwarded-for", ip);
        answers.push(await requestResetAction(null, form({ email: "admin@example.com" })));
        await Promise.all(pendingAfter);
      }
      expect(answers).toEqual([SENT, SENT, SENT, SENT]);
      expect(sendEmail).toHaveBeenCalledTimes(3);
    });

    it("per-IP cap: the 6th request from one IP sends nothing; same answer", async () => {
      await createAdmin();
      const { limit, windowMs } = RATE_LIMITS.forgot;
      await seedRateLimit("forgot:ip:203.0.113.7", limit, windowMs);
      expect(await requestResetAction(null, form({ email: "admin@example.com" }))).toEqual(SENT);
      await Promise.all(pendingAfter);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("the limit is checked after the response: nothing is counted before the answer is returned", async () => {
      await createAdmin();
      const { limit, windowMs } = RATE_LIMITS.forgotEmail;
      await seedRateLimit(emailKey("admin@example.com"), limit, windowMs);
      deferAfter = true;
      const before = await db.rateLimitBucket.count();
      expect(await requestResetAction(null, form({ email: "admin@example.com" }))).toEqual(SENT);
      expect(await db.rateLimitBucket.count()).toBe(before);
      expect(deferredAfter).toHaveLength(1);
      await deferredAfter[0]!();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("keys hold the IP and a hash of the email, never the raw email", async () => {
      await createAdmin();
      await requestResetAction(null, form({ email: "admin@example.com" }));
      await Promise.all(pendingAfter);
      const keys = (await db.rateLimitBucket.findMany()).map((r) => r.key).sort();
      expect(keys).toEqual([emailKey("admin@example.com"), "forgot:ip:203.0.113.7"].sort());
      expect(keys.join(" ")).not.toContain("admin@");
    });
  });
});

describe("setPasswordAction", () => {
  beforeEach(async () => {
    requestHeaders.set("x-forwarded-for", "203.0.113.7");
    await resetTestDb();
  });

  it("valid token and matching valid passwords → password set, redirect to /login?reset=1", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "RESET");
    await expect(
      setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(await verifyPassword(row.passwordHash!, "newpass34")).toBe(true);
  });

  it("used or unknown token → expired state", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "RESET");
    const fd = () => form({ token, password: "newpass34", confirm: "newpass34" });
    await expect(setPasswordAction(null, fd())).rejects.toThrow("NEXT_REDIRECT");
    expect(await setPasswordAction(null, fd())).toEqual({ status: "expired" });
    expect(
      await setPasswordAction(null, form({ token: "nope", password: "newpass34", confirm: "newpass34" })),
    ).toEqual({ status: "expired" });
  });

  it("password breaking the rule → rule copy, token still usable", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(await setPasswordAction(null, form({ token, password: "short", confirm: "short" }))).toEqual({
      error: "At least 8 characters, with letters and numbers.",
    });
    await expect(
      setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
  });

  it("passwords that do not match → error, token still usable", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(
      await setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass35" })),
    ).toEqual({ error: "The passwords do not match." });
    expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("missing fields → rejected without touching the token", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(await setPasswordAction(null, form({ token, password: "newpass34" }))).toEqual({
      status: "expired",
    });
    expect(await setPasswordAction(null, form({ password: "newpass34", confirm: "newpass34" }))).toEqual({
      status: "expired",
    });
    expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("a userId sent with the form is ignored: the token alone decides whose password changes", async () => {
    const admin = await createAdmin();
    const other = await createUser({ email: "other@example.com", name: "O", role: "ADMIN" });
    const token = await issuePasswordToken(admin.id, "SET");
    await expect(
      setPasswordAction(
        null,
        form({ token, password: "newpass34", confirm: "newpass34", userId: other.id }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    const otherRow = await db.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(otherRow.passwordHash).toBeNull();
  });

  describe("per-IP rate limit (10 per 15 minutes)", () => {
    const TOO_MANY = "Too many attempts. Try again later.";
    const { limit, windowMs } = RATE_LIMITS["set-password"];

    it("the 10th submit from one IP still works", async () => {
      const admin = await createAdmin();
      const token = await issuePasswordToken(admin.id, "RESET");
      await seedRateLimit("set-password:ip:203.0.113.7", limit - 1, windowMs);
      await expect(
        setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
      ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    });

    it("the 11th is refused with the copy; the token is not consumed and the password not changed", async () => {
      const admin = await createAdmin();
      const token = await issuePasswordToken(admin.id, "RESET");
      await seedRateLimit("set-password:ip:203.0.113.7", limit, windowMs);
      expect(
        await setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
      ).toEqual({ error: TOO_MANY });
      expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(await verifyPassword(row.passwordHash!, "oldpass12")).toBe(true);

      // From another IP the same link still works.
      requestHeaders.set("x-forwarded-for", "198.51.100.20");
      await expect(
        setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
      ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    });
  });
});

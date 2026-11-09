import { generate, generateSecret } from "otplib";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession, getSession } from "@/server/auth/session";
import { requireAdmin } from "@/server/auth/guards";
import { verifyTotpAction } from "@/app/admin/2fa/actions";
import { confirmTotpAction, regenerateTotpKeyAction } from "@/app/admin/2fa/setup/actions";
import { RATE_LIMITS } from "@/server/rate-limit";
import { seedRateLimit } from "@/test/rate-limit";

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>([["x-forwarded-for", "203.0.113.7"]]);

vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(requestHeaders)),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const SECRET = generateSecret(); // fresh random key per run
const WRONG_COPY = "Wrong code. Try again.";
const LOCKED_COPY = "Too many attempts. Try again in 15 minutes, or reset your password.";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function wrongCode(secret: string): Promise<string> {
  const window = new Set(
    await Promise.all([-60, -30, 0, 30, 60].map((o) => generate({ secret, epoch: nowSeconds() + o }))),
  );
  for (let n = 0; ; n++) {
    const candidate = String(n).padStart(6, "0");
    if (!window.has(candidate)) return candidate;
  }
}

// Signs an admin in (cookie set) with TOTP confirmed or still to be set up.
async function signedInAdmin({ confirmed }: { confirmed: boolean }) {
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  if (confirmed) {
    await db.user.update({
      where: { id: admin.id },
      data: { totpSecret: SECRET, totpConfirmedAt: new Date() },
    });
  }
  jar.set(SESSION_COOKIE, await createSession(admin.id));
  return admin;
}

async function sessionVerified(): Promise<boolean> {
  const row = await db.session.findFirst({ where: { totpVerifiedAt: { not: null } } });
  return row !== null;
}

describe("admin 2FA", () => {
  beforeEach(async () => {
    await resetTestDb();
    jar.clear();
    setCalls.length = 0;
  });

  describe("verifyTotpAction (/admin/2fa)", () => {
    it("valid code → redirects to /admin, and requireAdmin then passes", async () => {
      const admin = await signedInAdmin({ confirmed: true });
      const code = await generate({ secret: SECRET });
      await expect(verifyTotpAction(null, form({ code }))).rejects.toThrow(/^NEXT_REDIRECT:\/admin$/);
      expect(await requireAdmin()).toEqual({ userId: admin.id });
    });

    it("wrong code → 'Wrong code. Try again.', session not verified", async () => {
      await signedInAdmin({ confirmed: true });
      expect(await verifyTotpAction(null, form({ code: await wrongCode(SECRET) }))).toEqual({
        error: WRONG_COPY,
      });
      expect(await sessionVerified()).toBe(false);
    });

    it("not exactly 6 digits → same copy, not counted as an attempt", async () => {
      const admin = await signedInAdmin({ confirmed: true });
      for (const code of ["12345", "1234567", "12a456", ""]) {
        expect(await verifyTotpAction(null, form({ code }))).toEqual({ error: WRONG_COPY });
      }
      expect(await verifyTotpAction(null, new FormData())).toEqual({ error: WRONG_COPY });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).failedLogins).toBe(0);
    });

    it("third wrong code → lockout copy, signed out (all sessions ended)", async () => {
      const admin = await signedInAdmin({ confirmed: true });
      const bad = await wrongCode(SECRET);
      await verifyTotpAction(null, form({ code: bad }));
      await verifyTotpAction(null, form({ code: bad }));
      expect(await verifyTotpAction(null, form({ code: bad }))).toEqual({
        error: LOCKED_COPY,
        locked: true,
      });
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
      expect(await getSession(jar.get(SESSION_COOKIE)!)).toBeNull();
      // The cookie is not touched, so Next.js does not re-render (and redirect) before the
      // copy is shown; it no longer opens anything.
      expect(setCalls).toHaveLength(0);
    });

    it("locked earlier by wrong passwords → lockout copy, code not checked, this session ended", async () => {
      const admin = await signedInAdmin({ confirmed: true });
      await db.user.update({
        where: { id: admin.id },
        data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
      });
      const code = await generate({ secret: SECRET });
      expect(await verifyTotpAction(null, form({ code }))).toEqual({ error: LOCKED_COPY, locked: true });
      expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
      expect(await sessionVerified()).toBe(false);
    });

    it("no session → redirects to /login", async () => {
      await expect(verifyTotpAction(null, form({ code: "123456" }))).rejects.toThrow(
        "NEXT_REDIRECT:/login",
      );
    });

    it("admin who has not set up TOTP → redirected to setup", async () => {
      await signedInAdmin({ confirmed: false });
      await expect(verifyTotpAction(null, form({ code: "123456" }))).rejects.toThrow(
        "NEXT_REDIRECT:/admin/2fa/setup",
      );
    });
  });

  describe("confirmTotpAction (/admin/2fa/setup)", () => {
    async function enrolledSecret(userId: string): Promise<string> {
      const { startTotpEnrollment } = await import("@/server/auth/totp");
      const { otpauthUrl } = await startTotpEnrollment(userId);
      return new URL(otpauthUrl).searchParams.get("secret")!;
    }

    it("valid code → TOTP confirmed, this session verified, redirect to /admin", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const secret = await enrolledSecret(admin.id);
      const code = await generate({ secret });
      await expect(confirmTotpAction(null, form({ code }))).rejects.toThrow(/^NEXT_REDIRECT:\/admin$/);
      expect(await requireAdmin()).toEqual({ userId: admin.id });
    });

    it("wrong code → 'Wrong code. Try again.', not confirmed", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const secret = await enrolledSecret(admin.id);
      expect(await confirmTotpAction(null, form({ code: await wrongCode(secret) }))).toEqual({
        error: WRONG_COPY,
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpConfirmedAt).toBeNull();
    });

    it("already confirmed → redirected to /admin/2fa", async () => {
      await signedInAdmin({ confirmed: true });
      await expect(confirmTotpAction(null, form({ code: "123456" }))).rejects.toThrow(
        /^NEXT_REDIRECT:\/admin\/2fa$/,
      );
    });
  });

  describe("per-IP rate limit on TOTP verify / confirm (10 per 15 minutes)", () => {
    const TOO_MANY = "Too many sign-in attempts from your network. Try again in 15 minutes.";
    const { limit, windowMs } = RATE_LIMITS.totp;

    it("verify: the 10th code from one IP is still checked", async () => {
      await signedInAdmin({ confirmed: true });
      await seedRateLimit("totp:ip:203.0.113.7", limit - 1, windowMs);
      const code = await generate({ secret: SECRET });
      await expect(verifyTotpAction(null, form({ code }))).rejects.toThrow(/^NEXT_REDIRECT:\/admin$/);
    });

    it("verify: the 11th is refused before the code is checked; not counted, session kept, not verified", async () => {
      const admin = await signedInAdmin({ confirmed: true });
      await seedRateLimit("totp:ip:203.0.113.7", limit, windowMs);
      const code = await generate({ secret: SECRET });
      expect(await verifyTotpAction(null, form({ code }))).toEqual({ error: TOO_MANY });
      expect(await verifyTotpAction(null, form({ code: await wrongCode(SECRET) }))).toEqual({ error: TOO_MANY });
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.failedLogins).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(row.totpLastUsedStep).toBeNull();
      expect(await sessionVerified()).toBe(false);
      // Not the lockout: this browser stays signed in (password step) and may try later.
      expect(await getSession(jar.get(SESSION_COOKIE)!)).not.toBeNull();
    });

    it("confirm: the 11th is refused before the code is checked; TOTP not confirmed", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const { startTotpEnrollment } = await import("@/server/auth/totp");
      const { otpauthUrl } = await startTotpEnrollment(admin.id);
      const secret = new URL(otpauthUrl).searchParams.get("secret")!;
      await seedRateLimit("totp:ip:203.0.113.7", limit, windowMs);
      expect(await confirmTotpAction(null, form({ code: await generate({ secret }) }))).toEqual({
        error: TOO_MANY,
      });
      const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.totpConfirmedAt).toBeNull();
      expect(row.failedLogins).toBe(0);
      expect(await getSession(jar.get(SESSION_COOKIE)!)).not.toBeNull();
    });

    it("each code attempt is counted under totp:ip:<client IP>", async () => {
      await signedInAdmin({ confirmed: true });
      await verifyTotpAction(null, form({ code: await wrongCode(SECRET) }));
      expect((await db.rateLimitBucket.findMany()).map((r) => [r.key, r.count])).toEqual([
        ["totp:ip:203.0.113.7", 1],
      ]);
    });
  });

  describe("pages", () => {
    it("/admin/2fa/setup shows the key in groups of 4, the otpauth URL and the instructions; noindex", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const { default: Page, metadata } = await import("./admin/2fa/setup/page");
      const html = renderToStaticMarkup(await Page());

      const secret = (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret!;
      const grouped = secret.match(/.{1,4}/g)!.join(" ");
      expect(html).toContain(grouped);
      expect(html).toContain("otpauth://totp/Apolles:admin%40example.com?secret=" + secret);
      expect(html).toContain("Add this key to your authenticator app, then enter the 6-digit code.");
      expect(html).toContain('name="code"');
      expect(html).toContain('inputMode="numeric"');
      expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it("/admin/2fa/setup shows a QR code image (server-made SVG data URI) above the manual key", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const { default: Page } = await import("./admin/2fa/setup/page");
      const html = renderToStaticMarkup(await Page());

      const img = html.match(/<img\b[^>]*>/)?.[0] ?? "";
      expect(img).toContain('alt="QR code for your authenticator app"');
      const src = img.match(/src="(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)"/)?.[1];
      expect(src).toBeDefined();
      const svg = Buffer.from(src!.split(",")[1]!, "base64").toString("utf8");
      expect(svg).toMatch(/^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).toMatch(/<\/svg>$/);

      // Same page still has the manual fallback, after the QR.
      const secret = (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret!;
      const fallback = html.indexOf("Can&#x27;t scan? Enter this key instead.");
      expect(fallback).toBeGreaterThan(html.indexOf("<img"));
      expect(html.indexOf(secret.match(/.{1,4}/g)!.join(" "))).toBeGreaterThan(fallback);
      expect(html.indexOf("otpauth://totp/")).toBeGreaterThan(fallback);
      // No client JS, no raw HTML injection: the secret is not in the image's URL as plain text.
      expect(img).not.toContain(secret);
    });

    it("/admin/2fa/setup: a reload shows the same key; 'Generate a new key' replaces it", async () => {
      const admin = await signedInAdmin({ confirmed: false });
      const { default: Page } = await import("./admin/2fa/setup/page");
      const first = renderToStaticMarkup(await Page());
      const firstSecret = (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret!;
      expect(renderToStaticMarkup(await Page())).toBe(first);
      expect(first).toContain("Generate a new key");

      await expect(regenerateTotpKeyAction()).rejects.toThrow("NEXT_REDIRECT:/admin/2fa/setup");
      const secondSecret = (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).totpSecret!;
      expect(secondSecret).not.toBe(firstSecret);
      expect(renderToStaticMarkup(await Page())).toContain(secondSecret.match(/.{1,4}/g)!.join(" "));
    });

    it("'Generate a new key' for a confirmed admin → /admin/2fa, secret kept; no session → /login", async () => {
      await signedInAdmin({ confirmed: true });
      await expect(regenerateTotpKeyAction()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
      expect((await db.user.findFirstOrThrow()).totpSecret).toBe(SECRET);
      jar.clear();
      await expect(regenerateTotpKeyAction()).rejects.toThrow("NEXT_REDIRECT:/login");
    });

    it("/admin/2fa/setup for an admin who already set up TOTP → /admin/2fa (secret kept)", async () => {
      await signedInAdmin({ confirmed: true });
      const { default: Page } = await import("./admin/2fa/setup/page");
      await expect(Page()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
      expect((await db.user.findFirstOrThrow()).totpSecret).toBe(SECRET);
    });

    it("/admin/2fa shows the code form; noindex", async () => {
      await signedInAdmin({ confirmed: true });
      const { default: Page, metadata } = await import("./admin/2fa/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toContain('name="code"');
      expect(html).toContain('autoComplete="one-time-code"');
      expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it("/admin/2fa for an admin without TOTP → /admin/2fa/setup", async () => {
      await signedInAdmin({ confirmed: false });
      const { default: Page } = await import("./admin/2fa/page");
      await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/admin/2fa/setup");
    });

    // A half-signed-in admin (password done, code not yet) can end the session from both pages.
    it("/admin/2fa and /admin/2fa/setup have a Sign out POST form to /logout, no plain link back to /login", async () => {
      const SIGN_OUT_FORM = /<form(?=[^>]*method="post")(?=[^>]*action="\/logout")[^>]*>\s*<button[^>]*type="submit"[^>]*>Sign out<\/button>\s*<\/form>/;
      await signedInAdmin({ confirmed: false });
      const { default: SetupPage } = await import("./admin/2fa/setup/page");
      const setup = renderToStaticMarkup(await SetupPage());
      expect(setup).toMatch(SIGN_OUT_FORM);
      expect(setup).not.toContain('href="/login"');

      await db.user.updateMany({ data: { totpConfirmedAt: new Date() } });
      const { default: CodePage } = await import("./admin/2fa/page");
      const code = renderToStaticMarkup(await CodePage());
      expect(code).toMatch(SIGN_OUT_FORM);
      expect(code).not.toContain('href="/login"');
    });

    it("/admin: verified admin → /admin/agencies; unverified → /admin/2fa", async () => {
      const { default: Page } = await import("./admin/page");
      await signedInAdmin({ confirmed: true });
      await expect(Page()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
      await db.session.updateMany({ data: { totpVerifiedAt: new Date() } });
      await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/admin/agencies");
    });
  });
});

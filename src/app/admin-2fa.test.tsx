import { generate } from "otplib";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession, getSession } from "@/server/auth/session";
import { requireAdmin } from "@/server/auth/guards";
import { verifyTotpAction } from "@/app/admin/2fa/actions";
import { confirmTotpAction } from "@/app/admin/2fa/setup/actions";

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
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

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
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

    it("/admin: verified admin → /admin/agencies; unverified → /admin/2fa", async () => {
      const { default: Page } = await import("./admin/page");
      await signedInAdmin({ confirmed: true });
      await expect(Page()).rejects.toThrow(/^NEXT_REDIRECT:\/admin\/2fa$/);
      await db.session.updateMany({ data: { totpVerifiedAt: new Date() } });
      await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/admin/agencies");
    });
  });
});

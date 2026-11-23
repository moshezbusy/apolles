import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPasswordLink } from "@/server/auth/password-tokens";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/server/auth/password-tokens", () => ({
  checkPasswordLink: vi.fn(),
  consumePasswordToken: vi.fn(),
  requestReset: vi.fn(),
}));

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function renderSetPassword(): Promise<string> {
  const { default: Page } = await import("./set-password/[token]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: TOKEN }) }));
}

describe("/set-password/[token]", () => {
  beforeEach(() => {
    vi.mocked(checkPasswordLink).mockReset();
  });

  it("SET token → 'Set your password' with the form, button disabled", async () => {
    vi.mocked(checkPasswordLink).mockResolvedValue({ usable: true, purpose: "SET" });
    const html = await renderSetPassword();
    expect(checkPasswordLink).toHaveBeenCalledWith(TOKEN);
    expect(html).toContain("Set your password");
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain("At least 8 characters, with letters and numbers.");
  });

  it("RESET token → 'Create a new password'", async () => {
    vi.mocked(checkPasswordLink).mockResolvedValue({ usable: true, purpose: "RESET" });
    const html = await renderSetPassword();
    expect(html).toContain("Create a new password");
    expect(html).not.toContain("Set your password");
  });

  it("unusable token → expired state with 'Send a new link' to /forgot-password, no form", async () => {
    vi.mocked(checkPasswordLink).mockResolvedValue({ usable: false, purpose: null });
    const html = await renderSetPassword();
    expect(html).toContain("This link has expired");
    expect(html).toContain("Send a new link");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("set-up link");
  });

  it("an expired or used invitation → 'This set-up link has expired', 72 hours, and how to get a new one", async () => {
    vi.mocked(checkPasswordLink).mockResolvedValue({ usable: false, purpose: "SET" });
    const html = await renderSetPassword();
    expect(html).toContain("This set-up link has expired");
    expect(html).toContain("Set-up links work for 72 hours and can be used once.");
    expect(html).toContain("we will send you a new one");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("60 minutes");
  });

  it("an expired reset link keeps the 60-minute wording", async () => {
    vi.mocked(checkPasswordLink).mockResolvedValue({ usable: false, purpose: "RESET" });
    const html = await renderSetPassword();
    expect(html).toContain("This link has expired");
    expect(html).toContain("Reset links work for 60 minutes and can be used once.");
  });

  it("is noindex and sends no referrer", async () => {
    const { metadata } = await import("./set-password/[token]/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("/forgot-password", () => {
  it("shows the email form and is noindex", async () => {
    const { default: Page, metadata } = await import("./forgot-password/page");
    const html = renderToStaticMarkup(Page());
    expect(html).toContain('name="email"');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("/login success notice", () => {
  it("?reset=1 → 'Your password is set', and other devices were signed out", async () => {
    const { default: Page } = await import("./login/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ reset: "1" }) }));
    expect(html).toContain("Your password is set.");
    expect(html).toContain("other devices signed in to your account were signed out");
  });

  it("no notice without ?reset=1", async () => {
    const { default: Page } = await import("./login/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Your password is set.");
  });
});

describe("/login in the mockup layout", () => {
  it("shows the wordmark, 'Welcome back' and the 12-hour sign-out note", async () => {
    const { default: Page } = await import("./login/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Apolles");
    expect(html).toContain("Welcome back");
    expect(html).toContain("For your security, you are signed out automatically after 12 hours.");
    // Join Apolles exists since plan 7 (owner decision 17.11.2026: build screens 01 to 03).
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>Apply for access<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>Join Apolles<\/a>/);
    expect(html).toContain("Terms and Privacy");
  });
});

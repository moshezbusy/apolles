import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findUsablePasswordToken } from "@/server/auth/password-tokens";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/server/auth/password-tokens", () => ({
  findUsablePasswordToken: vi.fn(),
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
    vi.mocked(findUsablePasswordToken).mockReset();
  });

  it("SET token → 'Set your password' with the form, button disabled", async () => {
    vi.mocked(findUsablePasswordToken).mockResolvedValue("SET");
    const html = await renderSetPassword();
    expect(findUsablePasswordToken).toHaveBeenCalledWith(TOKEN);
    expect(html).toContain("Set your password");
    expect(html).toContain('name="password"');
    expect(html).toContain('name="confirm"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toContain("At least 8 characters, with letters and numbers.");
  });

  it("RESET token → 'Create a new password'", async () => {
    vi.mocked(findUsablePasswordToken).mockResolvedValue("RESET");
    const html = await renderSetPassword();
    expect(html).toContain("Create a new password");
    expect(html).not.toContain("Set your password");
  });

  it("unusable token → expired state with 'Send a new link' to /forgot-password, no form", async () => {
    vi.mocked(findUsablePasswordToken).mockResolvedValue(null);
    const html = await renderSetPassword();
    expect(html).toContain("Send a new link");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('name="password"');
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
  it("?reset=1 → 'Your password is set. Sign in.'", async () => {
    const { default: Page } = await import("./login/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ reset: "1" }) }));
    expect(html).toContain("Your password is set. Sign in.");
  });

  it("no notice without ?reset=1", async () => {
    const { default: Page } = await import("./login/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Your password is set.");
  });
});

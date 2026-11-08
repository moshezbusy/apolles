import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminHeader } from "@/components/AdminHeader";
import { TopupForm } from "@/app/admin/agencies/[id]/wallet/wallet-forms";

const SIGN_OUT_FORM = /<form(?=[^>]*method="post")(?=[^>]*action="\/logout")[^>]*>\s*<button[^>]*type="submit"[^>]*>Sign out<\/button>\s*<\/form>/;

const adminDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "admin");

// Every page.tsx under src/app/admin, as a path relative to it ("agencies/new/page.tsx").
function adminPages(dir = adminDir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return adminPages(full);
    return entry.name === "page.tsx" ? [path.relative(adminDir, full).split(path.sep).join("/")] : [];
  });
}

describe("AdminHeader", () => {
  const html = renderToStaticMarkup(<AdminHeader />);

  it("shows the Apolles Admin wordmark and an Agencies link", () => {
    expect(html).toContain("Apolles Admin");
    expect(html).toMatch(/<a[^>]*href="\/admin\/agencies"[^>]*>Agencies<\/a>/);
  });

  it("has a Sign out POST form to /logout", () => {
    expect(html).toMatch(SIGN_OUT_FORM);
  });
});

describe("admin pages", () => {
  it("the agencies layout shows the admin header above the page", async () => {
    const { default: AgenciesLayout } = await import("./admin/agencies/layout");
    const html = renderToStaticMarkup(<AgenciesLayout>{<p>page body</p>}</AgenciesLayout>);
    expect(html).toMatch(SIGN_OUT_FORM);
    expect(html.indexOf("Apolles Admin")).toBeLessThan(html.indexOf("<p>page body</p>"));
  });

  // The header (and so Sign out) comes from the agencies layout. Only these pages live outside
  // it: /admin only redirects, and the 2fa pages have their own Sign out form (tested in
  // admin-2fa.test.tsx) because a half-signed-in admin must not see the admin menu.
  it("every admin page is under the agencies layout, apart from /admin and the 2fa pages", () => {
    const outside = adminPages().filter((page) => !page.startsWith("agencies/"));
    expect(outside.sort()).toEqual(["2fa/page.tsx", "2fa/setup/page.tsx", "page.tsx"]);
    expect(adminPages().filter((page) => page.startsWith("agencies/")).length).toBeGreaterThanOrEqual(4);
  });
});

describe("wallet top-up form", () => {
  it("asks for the bank's own transfer reference and warns against the agency reference", () => {
    const html = renderToStaticMarkup(
      <TopupForm agencyId="a1" agencyName="Sunrise" action={async () => null} />,
    );
    expect(html).toContain("Bank&#x27;s transfer reference (from the bank statement)");
    expect(html).not.toContain(">Bank transfer reference<");
    // The hint is tied to the input, so screen readers read it with the field.
    const hint = html.match(/<p id="([^"]+)"[^>]*>Not the agency reference \(APL-…\)\.<\/p>/);
    expect(hint).not.toBeNull();
    const input = html.match(/<input[^>]*name="bankTransferRef"[^>]*>/)?.[0] ?? "";
    expect(input).toContain(`aria-describedby="${hint?.[1]}"`);
  });
});

import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function rules(): Promise<HeaderRule[]> {
  if (!nextConfig.headers) throw new Error("next.config has no headers()");
  return (await nextConfig.headers()) as HeaderRule[];
}

function headersFor(all: HeaderRule[], source: string): Record<string, string> {
  const rule = all.find((r) => r.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
}

describe("next.config headers", () => {
  it("no page can be shown inside a frame on another site (clickjacking), on every route", async () => {
    const all = headersFor(await rules(), "/:path*");
    expect(all["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(all["X-Frame-Options"]).toBe("DENY");
  });

  // These used to exist only in a hand-edited proxy file; the app now sends them itself.
  it("every route: HTTPS only, no type guessing, a short Referer, no camera / microphone / location", async () => {
    const all = headersFor(await rules(), "/:path*");
    expect(all["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(all["X-Content-Type-Options"]).toBe("nosniff");
    expect(all["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(all["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("every route: no plugins, no <base> hijack, forms post only to this site", async () => {
    const csp = headersFor(await rules(), "/:path*")["Content-Security-Policy"] ?? "";
    expect(csp.split(";").map((part) => part.trim())).toEqual([
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]);
  });

  // When two rules set the same header for one path, Next.js uses the later rule: the default
  // must come first so the stricter per-route values still win.
  it("the default Referrer-Policy comes before the stricter per-route ones, which override it", async () => {
    const list = await rules();
    const index = (source: string) => list.findIndex((r) => r.source === source);
    expect(index("/:path*")).toBe(0);
    for (const source of ["/set-password/:token*", "/q/:token*"]) {
      expect(index(source)).toBeGreaterThan(0);
      expect(headersFor(list, source)["Referrer-Policy"]).toBe("no-referrer");
    }
  });

  it("does not announce the framework in an X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("keeps the existing per-route headers", async () => {
    const list = await rules();
    expect(headersFor(list, "/set-password/:token*")).toEqual({
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    expect(headersFor(list, "/forgot-password")).toEqual({ "X-Robots-Tag": "noindex, nofollow" });
    expect(headersFor(list, "/admin/:path*")).toEqual({ "X-Robots-Tag": "noindex, nofollow" });
  });

  // Client quote pages hold the quote's link token in the URL (plan 5c).
  it("client quote pages: no Referer, no indexing, no shared cache", async () => {
    expect(headersFor(await rules(), "/q/:token*")).toEqual({
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    });
  });

  // The setup page shows a QR code that contains the TOTP secret: no cache may keep it.
  it("/admin/2fa/setup is never cached (the QR code holds the secret)", async () => {
    expect(headersFor(await rules(), "/admin/2fa/setup")).toEqual({ "Cache-Control": "no-store" });
  });

  // The staging container runs the self-contained server that `next build` writes to
  // .next/standalone (deploy/staging, Dockerfile).
  it("builds the standalone server used by the container image", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("AI assistant consent: forms may lead back to Claude or ChatGPT only, nothing is cached, no Referer", async () => {
    const all = await rules();
    const consent = headersFor(all, "/oauth/consent/:path*");
    expect(consent["Content-Security-Policy"]?.split(";").map((part) => part.trim())).toEqual([
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://claude.ai https://claude.com https://chatgpt.com",
    ]);
    expect(consent["Cache-Control"]).toBe("no-store");
    expect(consent["Referrer-Policy"]).toBe("no-referrer");
    expect(headersFor(all, "/oauth/:path*")["Cache-Control"]).toBe("no-store");
  });
});

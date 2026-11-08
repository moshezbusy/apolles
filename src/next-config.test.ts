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
    expect(all["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(all["X-Frame-Options"]).toBe("DENY");
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
});

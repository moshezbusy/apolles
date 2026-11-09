import { describe, expect, it } from "vitest";
import { totpQrSvgDataUri } from "@/server/auth/totp-qr";

const URL_ = "otpauth://totp/Apolles:admin%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Apolles";
const PREFIX = "data:image/svg+xml;base64,";

function decode(uri: string): string {
  return Buffer.from(uri.slice(PREFIX.length), "base64").toString("utf8");
}

describe("totpQrSvgDataUri", () => {
  it("returns a base64 SVG data URI", async () => {
    const uri = totpQrSvgDataUri(URL_);
    expect(uri.startsWith(PREFIX)).toBe(true);
    const svg = decode(uri);
    expect(svg).toMatch(/^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).not.toContain("<script");
  });

  it("is deterministic for the same URL and differs for another", async () => {
    expect(totpQrSvgDataUri(URL_)).toBe(totpQrSvgDataUri(URL_));
    expect(totpQrSvgDataUri(URL_ + "x")).not.toBe(totpQrSvgDataUri(URL_));
  });

  it("uses error correction level M or higher (M is larger than L for the same text)", async () => {
    const { renderSVG } = await import("uqr");
    const low = renderSVG(URL_, { ecc: "L" });
    const used = decode(totpQrSvgDataUri(URL_));
    expect(used).not.toBe(low);
    expect(used.length).toBeGreaterThanOrEqual(low.length);
  });
});

import { renderSVG } from "uqr";

// QR code for the authenticator-app setup, made on the server as an SVG image inside a
// data URI, so no client JavaScript and no raw HTML injection are needed (it goes into an
// <img src>). The otpauth URL holds the TOTP secret: it is never logged here, and the page
// that shows this is sent with Cache-Control: no-store (next.config.ts).
// Error correction level M (about 15% damage tolerated) keeps the code easy to scan.
export function totpQrSvgDataUri(otpauthUrl: string): string {
  const svg = renderSVG(otpauthUrl, { ecc: "M", border: 2 });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

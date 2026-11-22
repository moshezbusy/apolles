import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` also writes a self-contained server (.next/standalone) with only the files
  // it needs; the staging container image runs that (Dockerfile, deploy/staging).
  output: "standalone",
  // pdfkit reads its font metric files from its own folder at run time: load it from
  // node_modules instead of bundling it (src/server/booking/voucher.ts).
  serverExternalPackages: ["pdfkit"],
  async headers() {
    return [
      // No page may be shown inside a frame on another site (clickjacking: a hidden admin
      // page under a fake button). CSP frame-ancestors for current browsers, X-Frame-Options
      // for older ones.
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // Set-password links carry a secret token in the URL: never send it on in a Referer
      // header, and keep these pages out of search engines.
      {
        source: "/set-password/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // Client quote pages (plan 5c): the URL holds the quote's link token. Never send it on in a
      // Referer header (hotel photos come from another host), keep the pages out of search
      // engines, and let no shared cache keep a client's proposal.
      {
        source: "/q/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/forgot-password",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // AI connector (plan 11): the authorize page carries the assistant's request in its URL
      // and the token endpoint answers with tokens. No cache may keep them, no Referer sends
      // the URL on, and search engines leave them alone.
      {
        source: "/oauth/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      // The setup page shows a QR code (and text) that contain the TOTP secret: no browser
      // or proxy cache may keep it.
      {
        source: "/admin/2fa/setup",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

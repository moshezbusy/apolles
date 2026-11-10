import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` also writes a self-contained server (.next/standalone) with only the files
  // it needs; the staging container image runs that (Dockerfile, deploy/staging).
  output: "standalone",
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
      {
        source: "/forgot-password",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
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

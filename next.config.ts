import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set-password links carry a secret token in the URL: never send it on in a Referer
  // header, and keep these pages out of search engines.
  async headers() {
    return [
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

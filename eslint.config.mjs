import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Non-app folders
    ".claude/**",
    ".agents/**",
    ".gemini/**",
    ".opencode/**",
    "_bmad/**",
    "_bmad-output/**",
    "api-docs/**",
    "docs/**",
    "apolles/**",
    "src/generated/**",
    ".superpowers/**",
  ]),
  // Agency isolation: UI and agent-facing code never touch the database directly. They call a
  // service in src/server, which scopes every query by agencyId. Test files are exempt (they
  // seed and inspect data).
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["src/server/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db", "**/server/db", "**/server/db.ts"],
              message:
                "Agent/UI code must not use the database directly. Call a service in src/server instead.",
            },
            {
              group: ["@/generated/prisma", "@/generated/prisma/**", "**/generated/prisma", "**/generated/prisma/**"],
              allowTypeImports: true,
              message:
                "Agent/UI code must not use the database directly. Call a service in src/server instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;

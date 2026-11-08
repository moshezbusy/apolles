import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const DB_MESSAGE =
  "Agent/UI code must not use the database directly. Call a service in src/server instead.";

// The database driver packages (and their subpaths): UI code could otherwise open its own
// connection. Exact names only, so look-alikes such as "pg-format" are not caught.
const DB_PACKAGE_REGEX = "^(pg|@prisma/client|@prisma/adapter-pg)(/.*)?$";

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
    files: ["src/**/*.{ts,tsx,js,jsx,mjs,mts,cjs,cts}"],
    ignores: ["src/server/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/db", "**/server/db", "**/server/db.ts"],
              message: DB_MESSAGE,
            },
            {
              group: ["@/generated/prisma", "@/generated/prisma/**", "**/generated/prisma", "**/generated/prisma/**"],
              allowTypeImports: true,
              message: DB_MESSAGE,
            },
            {
              regex: DB_PACKAGE_REGEX,
              allowTypeImports: true,
              message: DB_MESSAGE,
            },
          ],
        },
      ],
      // Dynamic import() and require() would bypass no-restricted-imports.
      "no-restricted-syntax": [
        "error",
        ...["ImportExpression", 'CallExpression[callee.name="require"]'].map((node) => ({
          selector: `${node}[${node === "ImportExpression" ? "source" : "arguments.0"}.value=/(^|\\/)server\\/db(\\.ts)?$|(^|\\/)generated\\/prisma(\\/|$)|^(pg|@prisma\\/client|@prisma\\/adapter-pg)(\\/|$)/]`,
          message: DB_MESSAGE,
        })),
      ],
    },
  },
]);

export default eslintConfig;

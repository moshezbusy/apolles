import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const DB_MESSAGE =
  "Agent/UI code must not use the database directly. Call a service in src/server instead.";

// The database driver packages (and their subpaths): UI code could otherwise open its own
// connection. Exact names only, so look-alikes such as "pg-format" are not caught.
const DB_PACKAGE_REGEX = "^(pg|@prisma/client|@prisma/adapter-pg)(/.*)?$";

// The MCP server (src/mcp) is a separate process that reaches Apolles over HTTP only (plan 11,
// design §4.3). It must never import app code, the database, the supplier (Expedia) or booking
// code, not even types; and it reads settings only through src/mcp/config.ts.
const MCP_MESSAGE =
  "The MCP server talks to Apolles over HTTP only: no imports from src/server, src/app, src/generated or the database packages.";
const MCP_ENV_MESSAGE = "In the MCP server, only src/mcp/config.ts reads the environment.";
// Aliases, relative paths that climb out of src/mcp, and every Prisma package.
const MCP_IMPORT_REGEX = "^(@/(server|app|generated)|(\\./)?(\\.\\./)+(src/)?(server|app|generated))(/.*)?$|^(pg|@prisma/[^/]+)(/.*)?$";
const MCP_IMPORT_SYNTAX = ["ImportExpression", 'CallExpression[callee.name="require"]'].map((node) => ({
  selector: `${node}[${node === "ImportExpression" ? "source" : "arguments.0"}.value=/${MCP_IMPORT_REGEX.replaceAll("/", "\\/")}/]`,
  message: MCP_MESSAGE,
}));
const MCP_ENV_SYNTAX = [
  { selector: 'MemberExpression[object.name="process"][property.name="env"]', message: MCP_ENV_MESSAGE },
  { selector: 'MemberExpression[object.name="process"][property.value="env"]', message: MCP_ENV_MESSAGE },
  { selector: 'MemberExpression[object.property.name="process"][property.name="env"]', message: MCP_ENV_MESSAGE },
];

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
  // The MCP fence. Listed after the block above so it replaces those two rules for src/mcp
  // (the database is covered here too). Test files are fenced as well.
  {
    files: ["src/mcp/**/*.{ts,tsx,js,jsx,mjs,mts,cjs,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:process", message: MCP_ENV_MESSAGE },
            { name: "process", message: MCP_ENV_MESSAGE },
          ],
          patterns: [{ regex: MCP_IMPORT_REGEX, message: MCP_MESSAGE }],
        },
      ],
      "no-restricted-syntax": ["error", ...MCP_IMPORT_SYNTAX, ...MCP_ENV_SYNTAX],
    },
  },
  {
    files: ["src/mcp/config.ts", "src/mcp/**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...MCP_IMPORT_SYNTAX] },
  },
]);

export default eslintConfig;

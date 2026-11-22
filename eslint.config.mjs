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
// code, not even types; and it reads settings only through src/mcp/config.ts. An allowlist:
// besides packages (zod, node:*), only its own files, as "./x" or "@/mcp/x".
const MCP_MESSAGE =
  "The MCP server talks to Apolles over HTTP only: it imports only its own files (./x or @/mcp/x), zod and node built-ins.";
const MCP_ENV_MESSAGE = "In the MCP server, only src/mcp/config.ts reads the environment.";
// Refused: any "@/" path outside @/mcp/ or with "..", any relative path that goes up, absolute
// paths and file: URLs, and the database packages.
const MCP_IMPORT_REGEX = "^@/(?!mcp/)|^@/.*\\.\\.|(^|/)\\.\\.(/|$)|^/|^file:|^(pg|@prisma/[^/]+)(/.*)?$";
const MCP_IMPORT_SYNTAX = [
  { selector: `ImportExpression[source.value=/${MCP_IMPORT_REGEX.replaceAll("/", "\\/")}/]`, message: MCP_MESSAGE },
  { selector: `CallExpression[callee.name="require"][arguments.0.value=/${MCP_IMPORT_REGEX.replaceAll("/", "\\/")}/]`, message: MCP_MESSAGE },
  // A computed specifier (template, variable) cannot be checked, so it is refused.
  { selector: 'ImportExpression:not([source.type="Literal"])', message: MCP_MESSAGE },
  { selector: 'CallExpression[callee.name="require"]:not([arguments.0.type="Literal"])', message: MCP_MESSAGE },
  // TypeScript's own import forms, which no-restricted-imports does not see.
  { selector: "TSImportEqualsDeclaration", message: MCP_MESSAGE },
  { selector: "TSImportType", message: MCP_MESSAGE },
];
const MCP_ENV_SYNTAX = [
  { selector: 'MemberExpression[object.name="process"][property.name="env"]', message: MCP_ENV_MESSAGE },
  { selector: 'MemberExpression[object.name="process"][computed=true]', message: MCP_ENV_MESSAGE },
  { selector: 'MemberExpression[object.property.name="process"][property.name="env"]', message: MCP_ENV_MESSAGE },
  // `const { env } = process`, `const p = process`, `const p = globalThis.process`.
  { selector: 'VariableDeclarator[init.name="process"]', message: MCP_ENV_MESSAGE },
  { selector: 'VariableDeclarator[init.property.name="process"]', message: MCP_ENV_MESSAGE },
  { selector: 'AssignmentExpression[right.name="process"]', message: MCP_ENV_MESSAGE },
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
    files: ["src/mcp/config.ts", "src/mcp/config.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...MCP_IMPORT_SYNTAX] },
  },
]);

export default eslintConfig;

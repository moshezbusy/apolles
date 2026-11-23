import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: repoRoot });
const MESSAGE = "Agent/UI code must not use the database directly. Call a service in src/server instead.";

async function messagesFor(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, filePath) });
  return result?.messages ?? [];
}

const restricted = (msgs: { ruleId: string | null; message: string }[]) =>
  msgs.filter(
    (m) => m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-syntax",
  );

describe("lint guard: no direct db access outside src/server", () => {
  const code = 'import { db } from "@/server/db";\nexport const x = db;\n';

  it("importing @/server/db from src/app/** fails lint", async () => {
    const found = restricted(await messagesFor(code, "src/app/fixture.ts"));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(MESSAGE);
  });

  it("relative paths to server/db from src/app/** fail lint", async () => {
    const rel = 'import { db } from "../server/db";\nexport const x = db;\n';
    expect(restricted(await messagesFor(rel, "src/app/fixture.ts"))).toHaveLength(1);
  });

  it("importing @/server/db from src/components/** fails lint", async () => {
    expect(restricted(await messagesFor(code, "src/components/fixture.tsx"))).toHaveLength(1);
  });

  it("importing the generated Prisma client from src/app/** fails lint", async () => {
    const gen = 'import { PrismaClient } from "@/generated/prisma/client";\nexport const x = PrismaClient;\n';
    expect(restricted(await messagesFor(gen, "src/app/fixture.ts"))).toHaveLength(1);
  });

  it("does not fire in src/server/**", async () => {
    expect(restricted(await messagesFor(code, "src/server/fixture.ts"))).toHaveLength(0);
  });

  it("does not fire in src/test/**", async () => {
    expect(restricted(await messagesFor(code, "src/test/fixture.ts"))).toHaveLength(0);
  });

  it("does not fire in test files under src/app/**", async () => {
    expect(restricted(await messagesFor(code, "src/app/fixture.test.ts"))).toHaveLength(0);
  });

  it.each([
    ["require of @/server/db", 'export const d = require("@/server/db");\n'],
    ["dynamic import of @/server/db", 'export const f = () => import("@/server/db");\n'],
    ["relative dynamic import", 'export const f = () => import("../server/db");\n'],
    ["generated client via dynamic import", 'export const f = () => import("@/generated/prisma/client");\n'],
  ])("%s from src/app/** fails lint", async (_name, src) => {
    const found = restricted(await messagesFor(src, "src/app/fixture.ts"));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(MESSAGE);
  });

  it("dynamic import is also blocked in src/lib/**", async () => {
    const src = 'export const f = () => import("@/server/db");\n';
    expect(restricted(await messagesFor(src, "src/lib/fixture.ts"))).toHaveLength(1);
  });

  it("dynamic imports do not fire in src/server/**", async () => {
    const src = 'export const f = () => import("@/server/db");\nexport const d = require("@/server/db");\n';
    expect(restricted(await messagesFor(src, "src/server/fixture.ts"))).toHaveLength(0);
  });

  it("a .mts file in src/app/** is covered", async () => {
    expect(restricted(await messagesFor(code, "src/app/fixture.mts"))).toHaveLength(1);
  });

  // The database driver packages themselves: UI code could otherwise open its own connection.
  describe("database driver packages", () => {
    const sources = ["pg", "pg/lib/client", "@prisma/adapter-pg", "@prisma/client", "@prisma/client/runtime/client"];

    it.each(sources)("static import of %s from src/app/** fails lint", async (source) => {
      const found = restricted(await messagesFor(`import * as m from "${source}";\nexport const x = m;\n`, "src/app/fixture.ts"));
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain(MESSAGE);
    });

    it.each(sources)("dynamic import of %s from src/components/** fails lint", async (source) => {
      const found = restricted(await messagesFor(`export const f = () => import("${source}");\n`, "src/components/fixture.tsx"));
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain(MESSAGE);
    });

    it.each(sources)("require of %s from src/lib/** fails lint", async (source) => {
      const found = restricted(await messagesFor(`export const d = require("${source}");\n`, "src/lib/fixture.ts"));
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain(MESSAGE);
    });

    it("look-alike package names are not blocked", async () => {
      const src = 'import a from "pg-format";\nimport b from "@prisma/client-extra";\nexport const x = [a, b];\n';
      expect(restricted(await messagesFor(src, "src/app/fixture.ts"))).toHaveLength(0);
    });

    it("does not fire in src/server/**", async () => {
      const src =
        'import { PrismaPg } from "@prisma/adapter-pg";\nimport pg from "pg";\nexport const f = () => import("@prisma/client");\nexport const x = [PrismaPg, pg];\n';
      expect(restricted(await messagesFor(src, "src/server/fixture.ts"))).toHaveLength(0);
    });
  });
});

// The MCP server (src/mcp) talks to Apolles over HTTP only: it must never reach the database,
// the supplier or any app code, and it reads settings only through src/mcp/config.ts.
describe("lint guard: the MCP server is fenced off", () => {
  const MCP_MESSAGE = "The MCP server talks to Apolles over HTTP only";
  const mcpRestricted = async (code: string, filePath = "src/mcp/x.ts") => restricted(await messagesFor(code, filePath));

  it('import { db } from "@/server/db" in src/mcp/x.ts fails lint', async () => {
    const found = await mcpRestricted('import { db } from "@/server/db";\nexport const x = db;\n');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(MCP_MESSAGE);
  });

  it("process.env.DATABASE_URL in src/mcp/x.ts fails lint", async () => {
    const found = await mcpRestricted("export const u = process.env.DATABASE_URL;\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("src/mcp/config.ts");
  });

  it.each([
    ["process.env in any form", 'export const a = process["env"];\nexport const b = globalThis.process.env;\n', 2],
    ["node:process", 'import { env } from "node:process";\nexport const a = env;\n', 1],
  ])("%s in src/mcp/x.ts fails lint", async (_name, code, count) => {
    expect(await mcpRestricted(code)).toHaveLength(count);
  });

  it("process.env is allowed only in src/mcp/config.ts and its test, still with the import fence", async () => {
    expect(await mcpRestricted("export const u = process.env.MCP_PUBLIC_URL;\n", "src/mcp/config.ts")).toHaveLength(0);
    expect(await mcpRestricted("export const u = process.env.MCP_PUBLIC_URL;\n", "src/mcp/config.test.ts")).toHaveLength(0);
    expect(await mcpRestricted("export const u = process.env.MCP_PUBLIC_URL;\n", "src/mcp/server.test.ts")).toHaveLength(1);
    expect(await mcpRestricted('import { db } from "@/server/db";\nexport const x = db;\n', "src/mcp/config.ts")).toHaveLength(1);
    expect(await mcpRestricted('import { db } from "@/server/db";\nexport const x = db;\n', "src/mcp/config.test.ts")).toHaveLength(1);
  });

  // An allowlist, not a list of forbidden places: each of these got past the first fence.
  it.each([
    ["the test helpers", 'import { db } from "@/test/db";\nexport const x = db;\n'],
    ["the worker", 'import w from "@/worker";\nexport const x = w;\n'],
    ["@/mcp/ climbing out", 'import d from "@/mcp/../server/db";\nexport const x = d;\n'],
    ["a relative path climbing out and back", 'import d from "../mcp/../server/db";\nexport const x = d;\n'],
    ["a template-literal dynamic import", "export const f = () => import(`@/server/db`);\n"],
    ["a computed require", 'const name = "@/server/db";\nexport const d = require(name);\n'],
    ["destructuring process", "const { env } = process;\nexport const x = env;\n"],
    ["aliasing process", "const p = process;\nexport const x = p.env;\n"],
    ["aliasing globalThis.process", "const p = globalThis.process;\nexport const x = p;\n"],
    ["a computed process member", 'export const x = process["e" + "nv"];\n'],
    ["any other @/ path", 'import { x } from "@/lib/countries";\nexport const y = x;\n'],
    ["an absolute path", 'import d from "/home/user/apolles/src/server/db";\nexport const x = d;\n'],
    ["a re-export", 'export * from "@/server/db";\n'],
    ["an inline type import", 'type T = import("@/server/db").X;\nexport type Y = T;\n'],
  ])("%s in src/mcp/x.ts fails lint", async (_name, code) => {
    expect((await mcpRestricted(code)).length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["@/mcp/x", 'import { a } from "@/mcp/tools";\nexport const x = a;\n'],
    ["./x", 'import { a } from "./tools";\nexport const x = a;\n'],
    ["a dynamic import of ./x", 'export const f = () => import("./tools");\n'],
    ["process outside env", "process.on(\"SIGTERM\", () => process.exit(0));\nexport const a = process.argv[1];\n"],
  ])("%s is allowed in src/mcp/x.ts", async (_name, code) => {
    expect(await mcpRestricted(code)).toHaveLength(0);
  });

  it.each([
    "@/server/ai/search-api",
    "@/server/supplier/expedia/adapter",
    "@/server/bookings/service",
    "@/generated/prisma/client",
    "@/app/api/ai/v1/search/route",
    "../server/db",
    "../server/supplier/expedia/client",
    "../app/layout",
    "../generated/prisma/client",
    "../../src/server/db",
    "pg",
    "pg/lib/client",
    "@prisma/client",
    "@prisma/adapter-pg",
  ])("static, type-only, dynamic and require imports of %s from src/mcp fail lint", async (source) => {
    expect(await mcpRestricted(`import * as m from "${source}";\nexport const x = m;\n`)).toHaveLength(1);
    expect(await mcpRestricted(`import type { T } from "${source}";\nexport type X = T;\n`)).toHaveLength(1);
    expect(await mcpRestricted(`export const f = () => import("${source}");\n`)).toHaveLength(1);
    expect(await mcpRestricted(`export const d = require("${source}");\n`)).toHaveLength(1);
    expect(await mcpRestricted(`export const f = () => import("${source}");\n`, "src/mcp/server.test.ts")).toHaveLength(1);
  });

  it("its own files, zod and node built-ins are allowed", async () => {
    const code = 'import { z } from "zod";\nimport http from "node:http";\nimport { loadConfig } from "./config";\nimport { createMcpServer } from "./server";\nexport const x = [z, http, loadConfig, createMcpServer];\n';
    expect(await mcpRestricted(code)).toHaveLength(0);
  });

  it("the real src/mcp files pass the fence", async () => {
    const results = await eslint.lintFiles([path.join(repoRoot, "src/mcp")]);
    const found = results.flatMap((r) => restricted(r.messages));
    expect(results.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});

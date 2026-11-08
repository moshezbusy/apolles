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
});

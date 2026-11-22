import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The assistant token opens the assistant search API and nothing else (plan 2026-11-22).
// getSession / requireAgent / requireAdmin read only the session cookie (session tests check that
// an assistant token is not a session); these checks make sure no other entry point ever starts
// reading assistant tokens or bearer headers.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(src, f).split(path.sep).join("/");
const all = files(src);

describe("assistant token isolation", () => {
  it("only the assistant API checks an assistant token", () => {
    const users = all.filter((f) => /verifyAccessToken/.test(readFileSync(f, "utf8"))).map(rel);
    expect(users.sort()).toEqual(["server/assistant/api-route.ts", "server/assistant/connections.ts"]);
  });

  it("only the assistant API routes use the assistant API handler", () => {
    const users = all.filter((f) => /handleAssistantCall/.test(readFileSync(f, "utf8"))).map(rel);
    expect(users.sort()).toEqual(["app/api/assistant/rates/route.ts", "app/api/assistant/search/route.ts", "server/assistant/api-route.ts"]);
  });

  it("no other app entry point reads an Authorization header", () => {
    const readers = all
      .filter((f) => rel(f).startsWith("app/") || rel(f).startsWith("server/auth/"))
      .filter((f) => /["']authorization["']/i.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(readers).toEqual([]);
  });

  it("the agent and admin guards read the session cookie only", () => {
    const guards = readFileSync(path.join(src, "server/auth/guards.ts"), "utf8");
    expect(guards).toContain("cookies()");
    expect(guards).not.toMatch(/headers\(\)|authorization|assistant/i);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// .env.example is the one place that lists every setting (CLAUDE.md: "Document variables in
// .env.example"). This keeps it complete: a new process.env.NAME in the code fails here until
// the template explains it.

const ROOT = join(import.meta.dirname, "..");
// Set by Node, Next.js or the test runner themselves, never by the person deploying.
const SET_BY_TOOLING = new Set(["NEXT_RUNTIME", "NEXT_PHASE"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" || entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe(".env.example", () => {
  const template = readFileSync(join(ROOT, ".env.example"), "utf8");
  const documented = new Set([...template.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

  it("lists every variable the code reads by name", () => {
    const read = new Set<string>();
    for (const file of [...sourceFiles("src"), ...sourceFiles("prisma"), ...sourceFiles("e2e"), "next.config.ts", "playwright.config.ts", "prisma.config.ts"]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) read.add(m[1]!);
      // Names read through a variable: process.env[name], with the names as string literals nearby.
      for (const m of text.matchAll(/"((?:EXPEDIA|POSTMARK|EMAIL|BANK_DETAILS|TOTP)_[A-Z0-9_]+)"/g)) read.add(m[1]!);
    }
    const missing = [...read].filter((name) => !documented.has(name) && !SET_BY_TOOLING.has(name)).sort();
    expect(missing).toEqual([]);
    expect(read.size).toBeGreaterThan(15);
  });

  it("no longer says to leave APP_ENV unset in production, and holds no real-looking secret", () => {
    expect(template).not.toMatch(/leave it unset\s+(#\s*)?everywhere else/i);
    expect(template).toMatch(/refuses to start unless this is exactly "staging" or "production"/);
    for (const name of ["POSTMARK_SERVER_TOKEN", "EXPEDIA_API_KEY", "EXPEDIA_SHARED_SECRET", "TOTP_ENCRYPTION_KEY"]) {
      const value = new RegExp(`^${name}=(.*)$`, "m").exec(template)?.[1] ?? "missing";
      expect(["", "replace-me"], name).toContain(value);
    }
  });
});

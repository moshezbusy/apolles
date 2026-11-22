import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The MCP container must never get database or supplier settings (design section 8). The compose
// file is read line by line, so no YAML package is needed: this file has a fixed, simple shape.
const compose = readFileSync(join(process.cwd(), "deploy/staging/docker-compose.yml"), "utf8");

function serviceBlock(name: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The next service (2 spaces) or a top-level key (0 spaces) ends the block.
    if (/^ {0,2}\S/.test(line)) break;
    block.push(line);
  }
  return block;
}

function environmentKeys(block: string[]): string[] {
  const at = block.findIndex((l) => l === "    environment:");
  if (at === -1) return [];
  const keys: string[] = [];
  for (const line of block.slice(at + 1)) {
    if (/^ {0,4}\S/.test(line)) break;
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

describe("staging compose: MCP container", () => {
  const block = serviceBlock("apolles-staging-mcp");

  it("exists, on the app image", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("    image: apolles-staging-app");
  });

  it("has no env file, so the app's settings never reach it", () => {
    expect(block.some((l) => /^\s*env_file\s*:/.test(l))).toBe(false);
  });

  it("gets exactly the five settings it reads", () => {
    expect(environmentKeys(block).sort()).toEqual(
      ["AI_MCP_SERVICE_KEY", "APOLLES_INTERNAL_URL", "APP_PUBLIC_URL", "MCP_PUBLIC_URL", "PORT"],
    );
  });

  it("gets no database or supplier setting", () => {
    for (const key of environmentKeys(block)) {
      expect(key).not.toMatch(/^(DATABASE_URL|POSTGRES_|EXPEDIA_|SUPPLIER_)/);
    }
  });

  it("publishes no port", () => {
    expect(block.some((l) => /^\s*ports\s*:/.test(l))).toBe(false);
  });
});

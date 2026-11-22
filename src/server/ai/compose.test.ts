import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The MCP container must never get database or supplier settings (design section 8). The compose
// file is read line by line, so no YAML package is needed: this file has a fixed, simple shape.

// Lines of one service. The block ends only at the next service (2 spaces + name:) or a
// top-level key; comments and blank lines inside it never end it.
function serviceBlock(compose: string, name: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}[A-Za-z0-9_-]+:/.test(line) || /^\S/.test(line)) break;
    block.push(line);
  }
  return block;
}

function environmentKeys(block: string[]): string[] {
  const at = block.findIndex((l) => l === "    environment:");
  if (at === -1) return [];
  const keys: string[] = [];
  for (const line of block.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (/^ {0,4}\S/.test(line)) break;
    const m = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (m) keys.push(m[1]!);
  }
  return keys;
}

function hasKey(block: string[], key: string): boolean {
  return block.some((l) => new RegExp(`^\\s*${key}\\s*:`).test(l));
}

describe("compose checker", () => {
  it("is not fooled by a 2-space comment inside the service", () => {
    const text = [
      "services:",
      "  mcp:",
      "    image: x",
      "  # a comment at service level",
      "    env_file: .env",
      "  other:",
      "    image: y",
      "",
    ].join("\n");
    const block = serviceBlock(text, "mcp");
    expect(hasKey(block, "env_file")).toBe(true);
    expect(serviceBlock(text, "other")).toEqual(["    image: y", ""]);
  });
});

describe("staging compose: MCP container", () => {
  const compose = readFileSync(join(process.cwd(), "deploy/staging/docker-compose.yml"), "utf8");
  const block = serviceBlock(compose, "apolles-staging-mcp");

  it("exists, on the app image", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("    image: apolles-staging-app");
  });

  it("has no env file, so the app's settings never reach it", () => {
    expect(hasKey(block, "env_file")).toBe(false);
  });

  it("gets exactly the five settings it reads", () => {
    expect(environmentKeys(block).sort()).toEqual([
      "AI_MCP_SERVICE_KEY",
      "APOLLES_INTERNAL_URL",
      "APP_PUBLIC_URL",
      "MCP_PUBLIC_URL",
      "PORT",
    ]);
  });

  it("gets no database or supplier setting", () => {
    for (const key of environmentKeys(block)) {
      expect(key).not.toMatch(/^(DATABASE_URL|POSTGRES_|EXPEDIA_|SUPPLIER_)/);
    }
  });

  it("publishes no port", () => {
    expect(hasKey(block, "ports")).toBe(false);
  });
});

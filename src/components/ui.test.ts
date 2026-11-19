import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cell, cellTop, input, table, tbody, td, thead, tr } from "./ui";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [full] : [];
  });
}

describe("phone layout of the shared styles (plan 9)", () => {
  it("inputs are 16px on a phone (no iPhone zoom) and 14px from sm up", () => {
    expect(input).toContain("text-base");
    expect(input).toContain("sm:text-sm");
    expect(input).not.toMatch(/(^| )text-sm( |$)/);
  });

  it("tables turn into cards below md: rows are blocks, headers hidden, cells labelled", () => {
    expect(table).toContain("max-md:block");
    expect(thead).toContain("max-md:hidden");
    expect(tbody).toContain("max-md:block");
    expect(tr).toContain("max-md:grid");
    expect(cell).toContain("max-md:before:content-[attr(data-label)]");
    expect(cellTop).toContain("max-md:before:content-[attr(data-label)]");
    expect(td).toContain(cell);
  });

  it("every table cell in the app has a data-label (its column name on a phone)", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(appDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<td\b[^>]*>/g)) {
        if (!match[0].includes("data-label")) missing.push(`${path.relative(appDir, file)}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every body row of a table uses the shared row style", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(appDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<tr\b[^>]*>/g)) {
        const isHeaderRow = /^<tr>$/.test(match[0]);
        if (!isHeaderRow && !/className=\{`?\$?\{?tr\b|className=\{tr\}/.test(match[0])) missing.push(`${path.relative(appDir, file)}: ${match[0].slice(0, 80)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

describe("globals.css", () => {
  // A dark-mode rule turned the page text light while cards stayed white: the staging
  // tables were unreadable on a Mac in dark mode. The app is light-only.
  it("has no dark-mode rule", () => {
    expect(css).not.toContain("prefers-color-scheme");
  });

  it("defines the mockup colours as theme tokens", () => {
    expect(css).toContain("--color-brand: #173f35;");
    expect(css).toContain("--color-ink: #17211d;");
    expect(css).toContain("--color-canvas: #faf9f6;");
  });
});

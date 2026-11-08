import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
  ADMIN_FILE,
  E2E_DATABASE_URL,
  E2E_DIR,
  EMAIL_SINK_FILE,
  assertE2eDatabase,
} from "./support/paths";

// Runs once before the e2e tests (after Playwright has started the dev server, which only
// connects to the database on the first request). Only ever touches a local *_e2e database:
//   1. sync the schema with `prisma db push` (no force / data-loss flags);
//   2. empty every table and create the admin (e2e/support/reset-and-seed.ts);
//   3. start with an empty mail sink.
export default function globalSetup(): void {
  assertE2eDatabase(E2E_DATABASE_URL);
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };

  mkdirSync(E2E_DIR, { recursive: true, mode: 0o700 });
  rmSync(ADMIN_FILE, { force: true });
  writeFileSync(EMAIL_SINK_FILE, "", "utf8");

  execFileSync("pnpm", ["exec", "prisma", "db", "push"], { stdio: "inherit", env });
  execFileSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      "./prisma/ts-loader.mjs",
      "e2e/support/reset-and-seed.ts",
    ],
    { stdio: "inherit", env },
  );
}

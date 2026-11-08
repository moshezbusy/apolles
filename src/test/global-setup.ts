import { execFileSync } from "node:child_process";

const DEFAULT_TEST_URL = "postgresql://postgres:postgres@localhost:5432/apolles_test";

// Runs once before all tests: makes sure we only ever touch a local *_test database,
// then syncs the schema with `prisma db push` (no force / data-loss flags).
export default function setup(): void {
  process.env.DATABASE_URL ??= DEFAULT_TEST_URL;
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run tests: DATABASE_URL host "${url.hostname}" is not local`);
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests: database "${dbName}" does not end in _test`);
  }
  process.env.EMAIL_PROVIDER ??= "console";
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.ADMIN_ALERT_EMAIL ??= "alerts@test.local";

  execFileSync("pnpm", ["exec", "prisma", "db", "push"], {
    stdio: "inherit",
    env: process.env,
  });
}

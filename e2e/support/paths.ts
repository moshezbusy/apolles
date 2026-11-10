import { tmpdir } from "node:os";
import { join } from "node:path";

// Shared by playwright.config.ts, the global setup, the seed script and the tests.
// Only node built-ins here: the seed script imports this file under plain Node.

export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;

// A local, throwaway database only (checked by assertE2eDatabase before anything touches it).
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/apolles_e2e";

// Outside test-results/: Playwright empties that folder after the web server has started,
// which would take the mail sink's folder away from under the running server.
export const E2E_DIR = join(tmpdir(), "apolles-e2e");
// The console email adapter appends every email here as one JSON line (EMAIL_SINK_FILE).
export const EMAIL_SINK_FILE = join(E2E_DIR, "emails.jsonl");
// Credentials of the admin the global setup creates (email, password, TOTP secret).
export const ADMIN_FILE = join(E2E_DIR, "admin.json");

export type E2eAdmin = { email: string; password: string; totpSecret: string };

// Refuses anything but a local database whose name ends in _e2e.
export function assertE2eDatabase(raw: string | undefined): void {
  if (!raw) throw new Error("Refusing to run e2e: DATABASE_URL is not set");
  const url = new URL(raw);
  const name = url.pathname.replace(/^\//, "");
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Refusing to run e2e: database host "${url.hostname}" is not local`);
  }
  if (!name.endsWith("_e2e")) {
    throw new Error(`Refusing to run e2e: database "${name}" does not end in _e2e`);
  }
}

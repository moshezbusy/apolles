import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_DATABASE_URL, E2E_PORT, EMAIL_SINK_FILE } from "./e2e/support/paths";

// The sandbox ships a preinstalled Chromium; use it only when it exists.
const sandboxChromium = "/opt/pw-browsers/chromium";

// End-to-end tests against `next dev` on port 3100 and a local *_e2e database
// (e2e/global-setup.ts checks the database, syncs the schema, empties it and seeds the admin).
// Emails go to the console adapter's mail sink file, where the tests read the links.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One database for every test: run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    trace: "off",
    // `next dev` compiles each page on its first visit.
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(existsSync(sandboxChromium)
          ? { launchOptions: { executablePath: sandboxChromium } }
          : {}),
      },
    },
  ],
  webServer: {
    command: `pnpm exec prisma generate && pnpm exec next dev --port ${E2E_PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      EMAIL_PROVIDER: "console",
      // Search rates from the fake supplier (development and tests only; refused elsewhere).
      SUPPLIER_MODE: "fake",
      EMAIL_SINK_FILE,
      APP_URL: BASE_URL,
      ADMIN_ALERT_EMAIL: "alerts@test.local",
      BANK_DETAILS_BENEFICIARY: "Apolles E2E Ltd",
      BANK_DETAILS_BANK_NAME: "E2E Test Bank",
      BANK_DETAILS_ACCOUNT_NUMBER: "000111222",
      BANK_DETAILS_IBAN: "IL00 0000 0000 0001 1122 2",
      BANK_DETAILS_SWIFT: "E2ETILIT",
    },
  },
});

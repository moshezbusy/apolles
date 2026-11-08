import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The sandbox ships a preinstalled Chromium; use it only when it exists.
const sandboxChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "e2e",
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
});

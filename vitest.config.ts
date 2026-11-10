import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against a local, throwaway database. global-setup.ts refuses anything else.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/apolles_test";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // DB tests (later tasks) share one database.
    fileParallelism: false,
  },
});

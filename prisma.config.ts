import { defineConfig } from "prisma/config";

// DATABASE_URL comes from the process environment (Prisma 7 does not load .env files).
// `prisma generate` does not connect, so a placeholder keeps it working without a database
// (CI typecheck/build). Commands that connect (migrate, db push) fail loudly on the placeholder.
const url =
  process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/not_configured";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});

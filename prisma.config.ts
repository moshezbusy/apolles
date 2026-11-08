import { defineConfig } from "prisma/config";

// DATABASE_URL comes from the process environment (Prisma 7 does not load .env files).
// `prisma generate` does not connect, so a placeholder keeps it working without a database
// (CI typecheck/build). Commands that connect (migrate, db push) fail loudly on the placeholder.
const url =
  process.env.DATABASE_URL ?? "postgresql://invalid:invalid@localhost:5432/not_configured";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `pnpm db:seed`: creates the first admin from SEED_ADMIN_EMAIL (see prisma/seed.ts).
    // Plain Node runs the TypeScript (type stripping); ts-loader.mjs resolves "@/..." imports.
    seed: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./prisma/ts-loader.mjs prisma/seed.ts",
  },
  datasource: { url },
});

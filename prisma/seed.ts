// `pnpm db:seed` (also run by `prisma db seed`). Creates the first admin from
// SEED_ADMIN_EMAIL and emails them a set-password link. Prints no token or link.
import { seedAdmin, seedAdminReport } from "@/server/admin-seed";

async function main(): Promise<number> {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) throw new Error("SEED_ADMIN_EMAIL is not set");
  const { message, exitCode } = seedAdminReport(await seedAdmin(email));
  (exitCode === 0 ? console.info : console.error)(message);
  return exitCode;
}

main().then(
  (exitCode) => process.exit(exitCode),
  (error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

// `pnpm db:seed` (also run by `prisma db seed`). Creates the first admin from
// SEED_ADMIN_EMAIL and emails them a set-password link. Prints no token or link.
import { seedAdmin } from "@/server/admin-seed";

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  if (!email) throw new Error("SEED_ADMIN_EMAIL is not set");
  const result = await seedAdmin(email);
  console.info(result === "CREATED" ? "Admin created. A set-password email was sent." : "Admin already exists.");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

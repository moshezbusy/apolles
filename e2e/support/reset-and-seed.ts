// Run by e2e/global-setup.ts under plain Node (see prisma/ts-loader.mjs), because the
// generated Prisma client is ESM and Playwright's own loader is not.
// Empties the e2e database and creates one ADMIN with a known password and a CONFIRMED
// TOTP secret, then writes those credentials (test-only, generated per run) to ADMIN_FILE.
// Also adds one destination (Paris) with three hotels, for the search screens; their rates
// come from the fake supplier (SUPPLIER_MODE=fake in playwright.config.ts).
// Prints nothing secret.
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { generateSecret } from "otplib";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { ADMIN_FILE, assertE2eDatabase, type E2eAdmin } from "./paths";

async function emptyDatabase(): Promise<void> {
  assertE2eDatabase(process.env.DATABASE_URL);
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main(): Promise<void> {
  assertE2eDatabase(process.env.DATABASE_URL);
  await emptyDatabase();

  const admin: E2eAdmin = {
    email: "admin@test.local",
    password: randomBytes(18).toString("base64url"),
    totpSecret: generateSecret({ length: 20 }),
  };
  await db.user.create({
    data: {
      email: admin.email,
      name: "E2E Admin",
      role: "ADMIN",
      passwordHash: await hashPassword(admin.password),
      totpSecret: admin.totpSecret,
      totpConfirmedAt: new Date(),
    },
  });
  await db.destination.create({
    data: { id: "e2e-paris", name: "Paris", nameFull: "Paris, Ile-de-France, France", type: "city", countryCode: "FR", propertyCount: 3, seenRunId: "e2e" },
  });
  const hotels = [
    { id: "e2e-1", name: "Hotel Lumiere", starRating: "4.5" },
    { id: "e2e-2", name: "Maison Rivoli", starRating: "3.0" },
    { id: "e2e-3", name: "Le Grand Opera", starRating: "5.0" },
  ];
  for (const [rank, hotel] of hotels.entries()) {
    await db.property.create({
      data: { ...hotel, city: "Paris", countryCode: "FR", rank, expediaCollect: true, active: true, catalogSeenRunId: "e2e" },
    });
    await db.destinationProperty.create({ data: { destinationId: "e2e-paris", propertyId: hotel.id } });
  }
  await writeFile(ADMIN_FILE, JSON.stringify(admin), { encoding: "utf8", mode: 0o600 });
  await db.$disconnect();
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error("e2e seed failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

import { db } from "@/server/db";

function assertTestDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("resetTestDb: DATABASE_URL is not set");
  const name = new URL(raw).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`resetTestDb refused: database "${name}" does not end in _test`);
  }
}

// Empties every application table. Test-only: refuses to run on a non-_test database.
export async function resetTestDb(): Promise<void> {
  assertTestDatabase();
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

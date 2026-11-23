import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { credit } from "@/server/wallet/ledger";

// The migration that makes the ledger append-only in the database itself. The test database is
// built with `prisma db push` (no raw SQL), so the trigger is installed here, inside a
// transaction that is always rolled back: the other tests' database is left as it was.
const MIGRATION = fileURLToPath(new URL("../../../prisma/migrations/20261123100100_ledger_append_only/migration.sql", import.meta.url));

function statements(): string[] {
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const trigger = sql.indexOf("CREATE TRIGGER");
  if (trigger < 0) throw new Error("the migration has no CREATE TRIGGER");
  return [sql.slice(0, trigger), sql.slice(trigger)];
}

class RollBack extends Error {}

describe("LedgerEntry is append-only in the database (migration ledger_append_only)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("refuses UPDATE and DELETE of a ledger row; an INSERT still works; the row is unchanged", async () => {
    const agency = await db.agency.create({ data: { name: "A", country: "IL", bankReference: "APL-0001" } });
    const entry = await credit({ agencyId: agency.id, type: "TOPUP_BANK", amountCents: 10_000, reason: "Bank transfer T1", idempotencyKey: "topup:T1" });
    const refused: string[] = [];
    let after: { amountCents: number; reason: string }[] = [];
    let inserted = 0;
    await expect(
      db.$transaction(async (tx) => {
        for (const statement of statements()) await tx.$executeRawUnsafe(statement);
        const attempt = async (name: string, run: () => Promise<unknown>) => {
          await tx.$executeRawUnsafe("SAVEPOINT attempt");
          try {
            await run();
          } catch (error) {
            refused.push(`${name}: ${/append-only/.test(String(error)) ? "append-only" : "other error"}`);
          }
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT attempt");
        };
        await attempt("update amount", () => tx.$executeRaw`UPDATE "LedgerEntry" SET "amountCents" = 999999 WHERE "id" = ${entry.id}`);
        await attempt("update reason", () => tx.$executeRaw`UPDATE "LedgerEntry" SET "reason" = 'changed' WHERE "id" = ${entry.id}`);
        await attempt("delete", () => tx.$executeRaw`DELETE FROM "LedgerEntry" WHERE "id" = ${entry.id}`);
        after = await tx.$queryRaw<{ amountCents: number; reason: string }[]>`SELECT "amountCents", "reason" FROM "LedgerEntry" WHERE "id" = ${entry.id}`;
        // Adding an entry is what the ledger is for.
        inserted = await tx.$executeRaw`
          INSERT INTO "LedgerEntry" ("id", "agencyId", "type", "amountCents", "currency", "reason", "idempotencyKey", "createdAt")
          VALUES ('e2', ${agency.id}, 'ADJUSTMENT', 500, 'USD', 'correction', 'adjust:1', now())`;
        throw new RollBack();
      }),
    ).rejects.toBeInstanceOf(RollBack);
    expect(refused).toEqual(["update amount: append-only", "update reason: append-only", "delete: append-only"]);
    expect(after).toEqual([{ amountCents: 10_000, reason: "Bank transfer T1" }]);
    expect(inserted).toBe(1);
    // Rolled back: the trigger is not left behind in the test database.
    const left = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'LedgerEntry_append_only'`;
    expect(Number(left[0]!.n)).toBe(0);
  });
});

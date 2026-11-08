import type { LedgerEntry } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { listEntries } from "@/server/wallet/ledger";

// Agency-scoped data access. Agent-facing code gets its data through `forAgency(session.agencyId)`
// so every query is filtered by the caller's agency and an id from another agency finds nothing
// (no IDOR). Later plans add booking helpers here.
export function forAgency(agencyId: string) {
  if (typeof agencyId !== "string" || agencyId.length === 0) {
    throw new Error("agencyId is required");
  }
  return {
    ledger: {
      list(cursor?: string, take?: number) {
        return listEntries(agencyId, cursor, take);
      },
      // findFirst with agencyId in the filter: never look an entry up by id alone.
      get(id: string): Promise<LedgerEntry | null> {
        return db.ledgerEntry.findFirst({ where: { id, agencyId } });
      },
    },
  };
}

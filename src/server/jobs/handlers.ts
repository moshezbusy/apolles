import { syncCatalog } from "@/server/content/catalog-sync";
import { syncInactive } from "@/server/content/inactive-sync";
import { syncRegions } from "@/server/content/regions-sync";
import { cleanupSnapshots } from "@/server/search/search";
import type { Handlers } from "./runner";

// The handler of every job kind (plan 2b). A kind without a handler fails visibly
// (lastError "no handler") instead of being skipped.
export const HANDLERS: Handlers = {
  "content.catalog": async () => {
    await syncCatalog();
  },
  "content.regions": async () => {
    await syncRegions();
  },
  "content.inactive": async () => {
    await syncInactive();
  },
  "search.cleanup": async () => {
    await cleanupSnapshots();
  },
};

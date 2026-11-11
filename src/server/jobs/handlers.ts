import { syncCatalog } from "@/server/content/catalog-sync";
import type { Handlers } from "./runner";

// The handler of every job kind (plan 2b). A kind without a handler fails visibly
// (lastError "no handler") instead of being skipped.
export const HANDLERS: Handlers = {
  "content.catalog": async () => {
    await syncCatalog();
  },
};

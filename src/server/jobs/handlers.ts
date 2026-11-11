import type { Handlers } from "./runner";

// The handler of every job kind. Filled in by the content sync and search tasks (plan 2b);
// a kind without a handler fails visibly (lastError "no handler") instead of being skipped.
export const HANDLERS: Handlers = {};

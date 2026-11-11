import { ExpediaAdapter } from "./expedia/adapter";
import { ExpediaContentSource } from "./expedia/content";
import { FakeContentSource, FakeSupplierAdapter } from "./fake";
import type { ContentSource, SupplierAdapter } from "./types";

// The one place that picks the supplier. Expedia always, except SUPPLIER_MODE=fake, which is
// allowed only on a developer's machine and in the browser tests: never with APP_ENV staging
// or production, and never in a production build. A wrong setting stops the request at once.

function fakeRequested(): boolean {
  const mode = process.env.SUPPLIER_MODE ?? "";
  if (mode === "" || mode === "expedia") return false;
  if (mode !== "fake") throw new Error(`Unknown SUPPLIER_MODE "${mode}"`);
  const appEnv = process.env.APP_ENV ?? "";
  if (appEnv === "staging" || appEnv === "production" || process.env.NODE_ENV === "production") {
    throw new Error("The fake supplier is only for development and tests");
  }
  return true;
}

export function supplierAdapter(): SupplierAdapter {
  return fakeRequested() ? new FakeSupplierAdapter() : new ExpediaAdapter();
}

export function contentSource(): ContentSource {
  return fakeRequested() ? new FakeContentSource() : new ExpediaContentSource();
}

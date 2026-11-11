import { ExpediaAdapter } from "./expedia/adapter";
import { ExpediaContentSource } from "./expedia/content";
import { FakeContentSource, FakeSupplierAdapter } from "./fake";
import type { ContentSource, SupplierAdapter } from "./types";

// The one place that picks the supplier. Expedia always, except SUPPLIER_MODE=fake (made-up
// hotels and rates). The fake is allowed on a developer's machine, in the browser tests, and
// on staging as a labelled demo until Expedia's test keys arrive. It is never allowed with
// APP_ENV=production, nor in a production build that is not staging. A wrong setting stops
// the request at once.

function fakeRequested(): boolean {
  const mode = process.env.SUPPLIER_MODE ?? "";
  if (mode === "" || mode === "expedia") return false;
  if (mode !== "fake") throw new Error(`Unknown SUPPLIER_MODE "${mode}"`);
  const appEnv = process.env.APP_ENV ?? "";
  if (appEnv === "production" || (process.env.NODE_ENV === "production" && appEnv !== "staging")) {
    throw new Error("The fake supplier is only for development, tests and the staging demo");
  }
  return true;
}

export function supplierAdapter(): SupplierAdapter {
  return fakeRequested() ? new FakeSupplierAdapter() : new ExpediaAdapter();
}

export function contentSource(): ContentSource {
  return fakeRequested() ? new FakeContentSource() : new ExpediaContentSource();
}

// True when pages must say that hotels, prices and bookings are sample data.
export function isDemoSupplier(): boolean {
  return fakeRequested();
}

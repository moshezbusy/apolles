import { SupplierRateLimited, SupplierTimeout, SupplierUnavailable } from "@/server/supplier/expedia/client";

// Content syncs read hundreds of pages from Expedia; one timeout or one "too many requests" on
// any page used to throw the whole run away. A page is now tried up to 3 times, waiting in
// between: as long as Expedia asks (Retry-After), otherwise 2 then 4 seconds; never more than a
// minute. Only for the read-only sync calls (regions, inactive hotels, the catalog link): a
// booking or price-check call is never repeated here.

const TRIES = 3;
const BASE_WAIT_MS = 2_000;
const MAX_WAIT_MS = 60_000;

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withSyncRetry<T>(call: () => Promise<T>, sleep: Sleep = realSleep): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const again = error instanceof SupplierTimeout || error instanceof SupplierRateLimited || error instanceof SupplierUnavailable;
      if (!again || attempt >= TRIES) throw error;
      const asked = error instanceof SupplierRateLimited ? error.retryAfterMs : null;
      await sleep(Math.min(MAX_WAIT_MS, asked ?? BASE_WAIT_MS * 2 ** (attempt - 1)));
    }
  }
}

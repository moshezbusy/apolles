"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { getClientIp, UNKNOWN_IP } from "@/server/client-ip";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { startSearch } from "@/server/search/search";
import { childAgesComplete, readSearchForm, toSearchInput, type SearchFormState } from "./form-state";

// Starts a search (screen 07) and opens its results. The agencyId comes only from the
// session; the agency's country (point of sale) is read on the server. Expedia gets the
// agent's IP and browser, as Rapid asks (Customer-Ip, User-Agent).

const UNAVAILABLE = "Hotel search is unavailable right now. Try again in a few minutes.";

export async function startSearchAction(_previous: SearchFormState, formData: FormData): Promise<SearchFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = readSearchForm(formData);
  if (!values.destinationId) return { status: "error", message: "Choose a destination from the list.", values };
  if (!childAgesComplete(values)) return { status: "error", message: "Choose the age of each child.", values };

  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders);
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 255);
  const supplierContext = { ...(ip !== UNKNOWN_IP ? { customerIp: ip } : {}), ...(userAgent ? { userAgent } : {}) };

  let snapshotId: string;
  try {
    ({ snapshotId } = await startSearch({ agencyId, userId, supplierContext }, toSearchInput(values)));
  } catch (error) {
    if (error instanceof SearchInputInvalid || error instanceof SearchRateLimited || error instanceof SearchUnavailable) {
      return { status: "error", message: error.message, values };
    }
    // Anything else (a supplier that is not set up, say) is logged by name only.
    console.error(`search failed: ${error instanceof Error ? error.name : "Error"}`);
    return { status: "error", message: UNAVAILABLE, values };
  }
  redirect(`/search/${snapshotId}`);
}

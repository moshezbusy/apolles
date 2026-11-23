"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { SEVERAL_ROOMS_UNAVAILABLE, SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { destinationById } from "@/server/search/destinations";
import { clearRecentSearches, rememberSearch } from "@/server/search/recent";
import { searchSummary, startSearch } from "@/server/search/search";
import type { Occupancy } from "@/server/supplier/types";
import { multiRoomAllowed } from "@/server/supplier";
import { supplierContextFrom } from "@/server/supplier-context";
import { childAgesComplete, readSearchForm, toSearchInput, type SearchFormState } from "./form-state";
import { keptParams, resultsHref } from "./kept-params";
import { quoteParam } from "./quote-param";

// Starts a search (screen 07) and opens its results. The agencyId comes only from the
// session; the agency's country (point of sale) is read on the server. Expedia gets the
// agent's IP and browser, as Rapid asks (Customer-Ip, User-Agent).

const UNAVAILABLE = "Hotel search is unavailable right now. Try again in a few minutes.";

export async function startSearchAction(_previous: SearchFormState, formData: FormData): Promise<SearchFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = readSearchForm(formData);
  if (!values.destinationId) return { status: "error", message: "Choose a destination from the list.", values };
  if (!childAgesComplete(values)) return { status: "error", message: "Choose the age of each child.", values };
  // Plan 10: several rooms only while multiRoomAllowed (the search service checks it again).
  if (values.rooms.length > 1 && !multiRoomAllowed()) return { status: "error", message: SEVERAL_ROOMS_UNAVAILABLE, values };

  const supplierContext = supplierContextFrom(await headers());

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
  await remember({ agencyId, userId }, toSearchInput(values));
  const quoteId = quoteParam(formData.get("quote"));
  redirect(`/search/${snapshotId}${quoteId ? `?quote=${quoteId}` : ""}`);
}

// "Recent searches" (best effort: the search goes on even if this cannot be saved).
async function remember(who: { agencyId: string; userId: string }, input: { destinationId: string; checkin: string; checkout: string; rooms: Occupancy[] }): Promise<void> {
  try {
    await rememberSearch(
      who,
      // The name is read on the server, never taken from the form.
      { destinationId: input.destinationId, destinationName: (await destinationById(input.destinationId))?.label ?? input.destinationId, checkin: input.checkin, checkout: input.checkout, rooms: input.rooms },
    );
  } catch (error) {
    console.error("recent search not saved", { error: error instanceof Error ? error.name : "Error" });
  }
}

// "Search again" on expired results (screens 08 and 09): one click runs the same search again
// (the destination, dates and guests are read from the agent's own stored search, never from
// the form) and opens the new results. If it cannot run, the agent goes back to the expired
// results with the reason; the search box there is filled in and can be changed.
export async function searchAgainAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const id = formData.get("snapshotId");
  if (typeof id !== "string" || !/^[a-z0-9]{1,64}$/.test(id)) redirect("/search");
  const quoteId = quoteParam(formData.get("quote"));
  const kept = keptParams(quoteId ? { quote: quoteId } : {});
  const summary = await searchSummary(agencyId, id);
  if (!summary) redirect("/search");
  const input = { destinationId: summary.destinationId, checkin: summary.checkin, checkout: summary.checkout, rooms: summary.rooms };
  const supplierContext = supplierContextFrom(await headers());

  let snapshotId: string | null = null;
  let problem: "input" | "limited" | "unavailable" = "unavailable";
  try {
    ({ snapshotId } = await startSearch({ agencyId, userId, supplierContext }, input));
  } catch (error) {
    if (error instanceof SearchInputInvalid) problem = "input";
    else if (error instanceof SearchRateLimited) problem = "limited";
    else if (!(error instanceof SearchUnavailable)) console.error(`search again failed: ${error instanceof Error ? error.name : "Error"}`);
  }
  if (!snapshotId) redirect(resultsHref(id, kept, { again: problem }));
  await remember({ agencyId, userId }, input);
  redirect(resultsHref(snapshotId, kept));
}

// "Clear all" under Recent searches.
export async function clearRecentAction(): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  await clearRecentSearches({ agencyId, userId });
  redirect("/search");
}

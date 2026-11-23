"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { loadMore } from "@/server/search/search";
import { supplierContextFrom } from "@/server/supplier-context";
import { keptParams, resultsHref } from "../kept-params";

// "Load more hotels": asks the supplier for the next 250 hotels of this search. The search is
// looked up with the session's agency; another agency's id does nothing. The agent comes back
// to the same results as before: the filters, the sort, the page and the quote link are kept
// (the form sends the page's own query string; only the known names are read from it). The
// supplier gets the agent's IP and browser, as on the first search (Customer-Ip, User-Agent).
export async function loadMoreAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const id = formData.get("snapshotId");
  if (typeof id !== "string" || !/^[a-z0-9]{1,64}$/.test(id)) redirect("/search");
  const back = formData.get("back");
  const kept = keptParams(new URLSearchParams(typeof back === "string" ? back.slice(0, 2_000) : ""));
  const supplierContext = supplierContextFrom(await headers());
  let outcome: "ok" | "gone" | "unavailable" | "limited" | "rejected";
  try {
    outcome = (await loadMore({ agencyId, userId, supplierContext }, id)) ? "ok" : "gone";
  } catch (error) {
    if (error instanceof SearchRateLimited) outcome = "limited";
    else if (error instanceof SearchInputInvalid) outcome = "rejected";
    else {
      if (!(error instanceof SearchUnavailable)) console.error(`load more failed: ${error instanceof Error ? error.name : "Error"}`);
      outcome = "unavailable";
    }
  }
  // Gone: the search expired meanwhile. Its page says so and offers "Search again".
  if (outcome === "ok" || outcome === "gone") redirect(resultsHref(id, kept));
  redirect(resultsHref(id, kept, { notice: outcome }));
}

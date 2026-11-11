"use server";

import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { loadMore } from "@/server/search/search";

// "Load more hotels": asks the supplier for the next 250 hotels of this search. The search is
// looked up with the session's agency; another agency's id does nothing.
export async function loadMoreAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const id = formData.get("snapshotId");
  if (typeof id !== "string" || !/^[a-z0-9]{1,64}$/.test(id)) redirect("/search");
  let outcome: "ok" | "gone" | "unavailable";
  try {
    outcome = (await loadMore({ agencyId, userId, supplierContext: {} }, id)) ? "ok" : "gone";
  } catch (error) {
    if (!(error instanceof SearchUnavailable || error instanceof SearchRateLimited)) {
      console.error(`load more failed: ${error instanceof Error ? error.name : "Error"}`);
    }
    outcome = "unavailable";
  }
  if (outcome === "gone") redirect("/search");
  redirect(outcome === "unavailable" ? `/search/${id}?notice=unavailable` : `/search/${id}`);
}

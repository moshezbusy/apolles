"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { searchOneHotel } from "@/server/search/search";
import { supplierContextFrom } from "@/server/supplier-context";
import { openPath, parseOpenFields } from "./query";

// "Show rates" on the page an assistant's result link opens (design §6). The only place that
// searches: every field is checked again here (the form can be forged), the agencyId comes only
// from the session, and the search is the same one the website runs for one hotel.
export async function showRatesAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const fields = parseOpenFields({
    hotel: formData.get("hotel")?.toString(),
    destId: formData.get("destId")?.toString(),
    in: formData.get("in")?.toString(),
    out: formData.get("out")?.toString(),
    rooms: formData.get("rooms")?.toString(),
  });
  if (!fields) redirect("/search/open?notice=invalid");

  const supplierContext = supplierContextFrom(await headers());
  let snapshotId: string;
  try {
    ({ snapshotId } = await searchOneHotel(
      { agencyId, userId, supplierContext },
      { destinationId: fields.destId, propertyId: fields.hotel, checkin: fields.checkin, checkout: fields.checkout, rooms: fields.rooms },
    ));
  } catch (error) {
    if (error instanceof SearchInputInvalid) redirect(openPath(fields, "invalid"));
    if (error instanceof SearchRateLimited) redirect(openPath(fields, "ratelimited"));
    if (error instanceof SearchUnavailable) redirect(openPath(fields, "unavailable"));
    // Anything else (a supplier that is not set up, say) is logged by name only.
    console.error(`show rates failed: ${error instanceof Error ? error.name : "Error"}`);
    redirect(openPath(fields, "unavailable"));
  }
  redirect(`/search/${snapshotId}/hotels/${fields.hotel}`);
}

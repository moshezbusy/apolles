"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { BookingNotFound, cancel } from "@/server/booking/service";
import { supplierContextFrom } from "@/server/supplier-context";

// "Confirm cancellation" (screen 12). The charge sent is only compared with the charge the
// server works out now; the refund is written only after the supplier confirms.
export async function cancelAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const bookingId = formData.get("bookingId");
  const expected = formData.get("expectedCharge");
  if (typeof bookingId !== "string" || typeof expected !== "string" || !/^\d{1,10}$/.test(expected)) notFound();
  let outcome;
  try {
    outcome = await cancel({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, bookingId, { expectedChargeMinor: Number(expected) });
  } catch (error) {
    if (error instanceof BookingNotFound) notFound();
    throw error;
  }
  revalidatePath("/", "layout"); // the header shows the balance (a refund changes it)
  const notice = { cancelled: "cancelled", pending: "cancel_pending", refused: "cancel_refused", not_allowed: "cancel_not_allowed" }[outcome.kind];
  redirect(`/bookings/${bookingId}?notice=${notice}`);
}

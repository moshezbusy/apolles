"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { BookingNotFound, cancel } from "@/server/booking/service";
import { setSellingPrice } from "@/server/booking/selling";
import { emailBookingToClient } from "@/server/booking/client-email";
import { supplierContextFrom } from "@/server/supplier-context";

// "Confirm cancellation" (screen 12). The charge sent is only compared with the charge the
// server works out now; the refund is written only after the supplier confirms.
export async function cancelAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const bookingId = formData.get("bookingId");
  const expected = formData.get("expectedCharge");
  if (typeof bookingId !== "string" || typeof expected !== "string" || !/^\d{1,10}$/.test(expected)) notFound();
  // Cancelling is final: the agent must tick "I understand" (screen 12).
  if (formData.get("confirmFinal") !== "on") redirect(`/bookings/${bookingId.slice(0, 64)}?notice=cancel_confirm`);
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

export type SellState = { status: "success" | "error"; message: string } | null;

// "Your selling price" (screens 11, 12): for the agency's reports only. It never changes the
// amount charged and is not on the voucher.
export async function sellingPriceAction(_previous: SellState, formData: FormData): Promise<SellState> {
  const { userId, agencyId } = await requireAgent();
  const field = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.slice(0, 20) : "";
  };
  const raw = formData.get("bookingId");
  const bookingId = typeof raw === "string" ? raw.slice(0, 64) : "";
  const clear = formData.get("clear") === "1";
  const result = await setSellingPrice(userId, agencyId, bookingId, { markupType: clear ? "" : field("markupType"), markupValue: clear ? "" : field("markupValue") });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/book/${bookingId}`);
  revalidatePath("/reporting");
  return { status: "success", message: "Selling price saved." };
}

export type EmailClientState = { status: "success" | "error"; message: string } | null;

// "Email to client" (screen 12, plan 8g). The service checks the booking, the address and limits.
export async function emailClientAction(_previous: EmailClientState, formData: FormData): Promise<EmailClientState> {
  const { userId, agencyId } = await requireAgent();
  const bookingId = formData.get("bookingId");
  const email = formData.get("email");
  if (typeof bookingId !== "string" || typeof email !== "string") return { status: "error", message: "Enter one valid email address." };
  const result = await emailBookingToClient(userId, agencyId, { bookingId: bookingId.slice(0, 64), email: email.slice(0, 300) });
  return result.ok ? { status: "success", message: "The voucher was emailed to the client." } : { status: "error", message: result.error };
}

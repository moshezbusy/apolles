"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { BookingInputInvalid, BookingNotFound, BookingRateExpired, book, createDraft } from "@/server/booking/service";
import { formatUsd } from "@/lib/money";
import { supplierContextFrom } from "@/server/supplier-context";
import { readGuestForm, toDraftInput, type BookFormState } from "./form-state";

// Booking actions (screens 10 and 11). Each checks the agent session and uses its agencyId;
// a price or an agencyId in the form is never read. The total sent with "Book" is only
// compared with the price the server checked.

export async function createDraftAction(_previous: BookFormState, formData: FormData): Promise<BookFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = readGuestForm(formData);
  let bookingId: string;
  try {
    ({ bookingId } = await createDraft({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, toDraftInput(values)));
  } catch (error) {
    if (error instanceof BookingInputInvalid || error instanceof BookingRateExpired) return { status: "error", message: error.message, values };
    throw error;
  }
  redirect(`/book/${bookingId}`);
}

export async function bookAction(_previous: BookFormState, formData: FormData): Promise<BookFormState> {
  const { userId, agencyId } = await requireAgent();
  const bookingId = formData.get("bookingId");
  const expected = formData.get("expectedTotal");
  if (typeof bookingId !== "string" || typeof expected !== "string" || !/^\d{1,10}$/.test(expected)) notFound();
  let outcome;
  try {
    outcome = await book(
      { agencyId, userId, supplierContext: supplierContextFrom(await headers()) },
      bookingId,
      { acceptedTerms: formData.get("acceptedTerms") === "on", expectedTotalMinor: Number(expected) },
    );
  } catch (error) {
    if (error instanceof BookingNotFound) notFound();
    throw error;
  }
  if (outcome.kind === "insufficient") {
    return { status: "error", message: `Your available balance is not enough for this booking. Missing: ${formatUsd(outcome.shortfallMinor)}. Top up your balance, then book.` };
  }
  if (outcome.kind === "review_again") return { status: "error", message: outcome.message };
  revalidatePath("/", "layout"); // the header shows the balance, which just changed
  redirect(`/bookings/${outcome.bookingId}`);
}

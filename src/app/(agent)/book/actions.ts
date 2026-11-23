"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { createClientFromGuest } from "@/server/clients";
import { audit } from "@/server/audit";
import { BookingInputInvalid, BookingNotFound, BookingRateExpired, book, createDraft, getBooking } from "@/server/booking/service";
import { updateDraftGuests } from "@/server/booking/drafts";
import { QUOTE_CHECK_NEEDED, quoteReview } from "@/server/quotes/quote-booking";
import { formatUsd } from "@/lib/money";
import { supplierContextFrom } from "@/server/supplier-context";
import { fieldsMessage, formFieldOf, guestFieldErrors, readGuestForm, toDraftInput, type BookFormState } from "./form-state";

// Booking actions (screens 10 and 11). Each checks the agent session and uses its agencyId;
// a price or an agencyId in the form is never read. The total sent with "Book" is only
// compared with the price the server checked.

// A wrong field is said under the field itself (and the first one gets the focus); the server's
// own check names the fields too, for anything the form's check let through.
function fieldErrorState(values: Record<string, string>): BookFormState {
  const fields = guestFieldErrors(values);
  const count = Object.keys(fields).length;
  return count > 0 ? { status: "error", message: fieldsMessage(count), values, fields } : null;
}

function inputErrorState(error: BookingInputInvalid | BookingRateExpired, values: Record<string, string>): BookFormState {
  const fields: Record<string, string> = {};
  if (error instanceof BookingInputInvalid) {
    for (const path of error.fields) {
      const field = formFieldOf(path);
      if (field) fields[field] ??= "Check this field.";
    }
  }
  return { status: "error", message: error.message, values, ...(Object.keys(fields).length > 0 ? { fields } : {}) };
}

export async function createDraftAction(_previous: BookFormState, formData: FormData): Promise<BookFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = readGuestForm(formData);
  const invalid = fieldErrorState(values);
  if (invalid) return invalid;
  let bookingId: string;
  try {
    ({ bookingId } = await createDraft({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, toDraftInput(values)));
  } catch (error) {
    if (error instanceof BookingInputInvalid || error instanceof BookingRateExpired) return inputErrorState(error, values);
    throw error;
  }
  // "Save the lead guest to Clients" (screen 10), only when no client was chosen. Best effort: the
  // booking goes on even if the client card cannot be made.
  if (values.saveClient === "on" && !values.clientId) {
    try {
      await createClientFromGuest(userId, agencyId, {
        givenName: values.r0_given_0 ?? "",
        familyName: values.r0_family_0 ?? "",
        email: values.leadEmail ?? "",
        phoneCountry: values.phoneCountry ?? "",
        phoneNumber: values.phoneNumber ?? "",
      });
    } catch (error) {
      console.error(`save lead guest to clients failed: ${error instanceof Error ? error.name : "Error"}`);
    }
  }
  redirect(`/book/${bookingId}`);
}

// "Edit guest details" (screen 11): the draft's names, contact and requests change in place, then
// back to the review page. A draft that was booked meanwhile goes to its booking page.
export async function updateDraftAction(_previous: BookFormState, formData: FormData): Promise<BookFormState> {
  const { userId, agencyId } = await requireAgent();
  const raw = formData.get("bookingId");
  const bookingId = typeof raw === "string" ? raw.slice(0, 64) : "";
  const values = readGuestForm(formData);
  const invalid = fieldErrorState(values);
  if (invalid) return invalid;
  const { rooms, leadEmail, leadPhone, specialRequests } = toDraftInput(values);
  try {
    await updateDraftGuests({ agencyId, userId }, bookingId, { rooms, leadEmail, leadPhone, specialRequests });
  } catch (error) {
    if (error instanceof BookingInputInvalid) return inputErrorState(error, values);
    if (error instanceof BookingNotFound) {
      const existing = await getBooking(agencyId, bookingId);
      if (existing) redirect(`/bookings/${existing.id}`);
      notFound();
    }
    throw error;
  }
  redirect(`/book/${bookingId}`);
}

export async function bookAction(_previous: BookFormState, formData: FormData): Promise<BookFormState> {
  const { userId, agencyId } = await requireAgent();
  const bookingId = formData.get("bookingId");
  const expected = formData.get("expectedTotal");
  if (typeof bookingId !== "string" || typeof expected !== "string" || !/^\d{1,10}$/.test(expected)) notFound();
  // A draft made from a quote: when the price or the terms are worse than what the client was
  // quoted (worked out here again, never taken from the page), booking needs the agent's tick
  // "I checked the new price and terms". Without it nothing is held or sent.
  const draft = await getBooking(agencyId, bookingId);
  if (draft?.status === "DRAFT") {
    const review = await quoteReview(agencyId, draft);
    if (review?.needsCheck) {
      if (formData.get("quoteChecked") !== "on") {
        revalidatePath(`/book/${draft.id}`); // the page draws the box and the tick again
        return { status: "error", message: QUOTE_CHECK_NEEDED };
      }
      await audit(userId, "booking.quote-check", "Booking", draft.id, undefined, { quoteId: review.quoteId, profitLower: review.profitLower, termsWorse: review.termsWorse, rateChanged: review.rateChanged });
    }
  }
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
    return {
      status: "error",
      message: `Your available balance is not enough for this booking. Missing: ${formatUsd(outcome.shortfallMinor)}. Top up your balance, then book. This booking is kept under Bookings, Not finished, for 7 days.`,
    };
  }
  // The price check is too old: the page offers to check it again (the form shows the button).
  if (outcome.kind === "review_again" && outcome.stale) {
    return { status: "error", message: "The price was checked more than 10 minutes ago. Check the price again, then book.", recheck: true };
  }
  if (outcome.kind === "review_again") return { status: "error", message: outcome.message };
  revalidatePath("/", "layout"); // the header shows the balance, which just changed
  redirect(`/bookings/${outcome.bookingId}`);
}

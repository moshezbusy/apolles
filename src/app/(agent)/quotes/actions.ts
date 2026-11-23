"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { createClient } from "@/server/clients";
import { prepareQuoteBooking } from "@/server/quotes/quote-booking";
import { refreshMessage, refreshStayPrices } from "@/server/quotes/refresh";
import { supplierContextFrom } from "@/server/supplier-context";
import {
  CLIENT_CHANGED,
  addFromSearch,
  addStay,
  archiveQuote,
  clearSelection,
  closeQuote,
  createQuote,
  deleteQuote,
  duplicateQuote,
  getQuote,
  moveHotel,
  removeHotel,
  removeRoom,
  removeStay,
  reopenQuote,
  selectForClient,
  setClientCancelDate,
  setRoomPrice,
  toggleAgencyPick,
  unarchiveQuote,
  updateQuoteSettings,
  type Result,
} from "@/server/quotes/quotes";
import { type EmailPreview, emailPreview, emailQuote, extendOffer, renewLink, shareLink, whatsappLink } from "@/server/quotes/sharing";
import type { ClientFormState } from "../clients/form-state";
import type { ActionState } from "./action-state";

// Quote actions (screens 09, 14, 15). Each one checks the agent session itself and passes the
// agencyId from it; an agencyId in the form is never read. Ids from the form (quote, destination,
// hotel, room) are only used together with that agencyId, so another agency's id finds nothing.

function text(formData: FormData, key: string, max = 100): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max) : "";
}

// The tick box a form shows when the server asks for the agent's explicit yes first.
const CONFIRM = {
  clientChange: { name: "confirmClientChange", label: "I understand: change the client, stop the old link and remove the client's selections and note" },
  belowNet: { name: "confirmBelowNet", label: "Yes, sell this room below my net price" },
} as const;

function done(result: Result, message?: string): ActionState {
  if (!result.ok) return { status: "error", message: result.error, ...(result.confirm ? { confirm: CONFIRM[result.confirm] } : {}) };
  revalidatePath(`/quotes/${result.id}`);
  revalidatePath("/quotes");
  return message ? { status: "success", message } : null;
}

export async function createQuoteAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  const clientId = text(formData, "clientId", 64);
  const result = await createQuote(userId, agencyId, clientId ? { clientId } : {});
  if (!result.ok) redirect("/quotes");
  redirect(`/quotes/${result.id}`);
}

export async function saveSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await updateQuoteSettings(userId, agencyId, text(formData, "quoteId", 64), {
    title: text(formData, "title", 200),
    clientId: text(formData, "clientId", 64),
    language: text(formData, "language", 4) as "EN" | "HE",
    message: text(formData, "message", 1100),
    showCancellation: formData.get("showCancellation") === "on",
    markupType: text(formData, "markupType", 10),
    markupValue: text(formData, "markupValue", 20),
    adults: text(formData, "adults", 4),
    childAges: text(formData, "childAges", 40),
    confirmClientChange: formData.get(CONFIRM.clientChange.name) === "on",
  });
  // Another client: say what was removed, not only "saved".
  return done(result, result.ok && result.clientChanged ? CLIENT_CHANGED : "Changes saved.");
}

// "Close quote" / "Reopen quote": finish a quote on purpose (a trip booked in part, a client who
// went quiet), and take it up again.
export async function closeQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await closeQuote(userId, agencyId, text(formData, "quoteId", 64)), "Quote closed. The client link now shows that the proposal is closed.");
}

export async function reopenQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await reopenQuote(userId, agencyId, text(formData, "quoteId", 64)), "Quote reopened.");
}

// "Extend offer": the client link is open again for the agency's number of days.
export async function extendOfferAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await extendOffer(userId, agencyId, text(formData, "quoteId", 64)), "Offer extended. Check that the prices are still right before you tell the client.");
}

// ---------- the quote list (screen 14): delete, archive, duplicate ----------

// Each one goes back to the list with a short notice (the card it was on may be gone).
export async function deleteQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await deleteQuote(userId, agencyId, text(formData, "quoteId", 64));
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/quotes");
  redirect("/quotes?notice=deleted");
}

export async function archiveQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await archiveQuote(userId, agencyId, text(formData, "quoteId", 64));
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/quotes");
  revalidatePath(`/quotes/${result.id}`);
  redirect("/quotes?notice=archived");
}

export async function unarchiveQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await unarchiveQuote(userId, agencyId, text(formData, "quoteId", 64)), "Quote back in the list. It stays closed until you choose Reopen quote.");
}

export async function duplicateQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await duplicateQuote(userId, agencyId, text(formData, "quoteId", 64));
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/quotes");
  redirect(`/quotes/${result.id}?notice=duplicated`);
}

// ---------- the agent chooses for the client ----------

export async function selectForClientAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await selectForClient(userId, agencyId, text(formData, "roomId", 64)));
}

export async function clearSelectionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await clearSelection(userId, agencyId, text(formData, "stayId", 64)));
}

// "Refresh prices" on a destination: one hotel search per hotel, then the rooms are updated.
export async function refreshPricesAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await refreshStayPrices({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, text(formData, "stayId", 64));
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath(`/quotes/${result.id}`);
  revalidatePath("/quotes");
  return { status: "success", message: refreshMessage(result.summary) };
}

// "+ Add a new client" on the quote: the client is saved, and the quote opens again with the new
// client chosen in the Client field (saved with "Save changes", like any other client choice).
const CLIENT_ERROR =
  "Check the form: first and last name, a WhatsApp phone with 7 to 15 digits, a valid email or none, a nationality, and notes up to 1,000 characters.";

// `quoteId` is bound by the page (never read from the form); it is checked against the agency here.
export async function createClientForQuoteAction(quoteId: string, _previous: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = {
    firstName: text(formData, "firstName", 100),
    lastName: text(formData, "lastName", 100),
    phone: text(formData, "phone", 100),
    email: text(formData, "email", 300),
    nationality: text(formData, "nationality", 10),
    notes: text(formData, "notes", 1100),
  };
  const quote = await getQuote(agencyId, String(quoteId).slice(0, 64));
  if (!quote) return { status: "error", message: "This quote was not found.", values };
  const result = await createClient(userId, agencyId, values);
  if (!result.ok) return { status: "error", message: CLIENT_ERROR, values };
  revalidatePath("/clients");
  redirect(`/quotes/${encodeURIComponent(quote.id)}?client=${encodeURIComponent(result.id)}`);
}

export async function addStayAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await addStay(userId, agencyId, text(formData, "quoteId", 64), {
    destinationId: text(formData, "destinationId", 64),
    checkin: text(formData, "checkin", 10),
    checkout: text(formData, "checkout", 10),
  });
  return done(result);
}

export async function removeStayAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await removeStay(userId, agencyId, text(formData, "stayId", 64)));
}

export async function hotelAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const hotelId = text(formData, "hotelId", 64);
  const what = text(formData, "do", 10);
  if (what === "up" || what === "down") return done(await moveHotel(userId, agencyId, hotelId, what));
  if (what === "pick") return done(await toggleAgencyPick(userId, agencyId, hotelId));
  if (what === "remove") return done(await removeHotel(userId, agencyId, hotelId));
  return { status: "error", message: "Unknown action." };
}

export async function roomPriceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await setRoomPrice(userId, agencyId, text(formData, "roomId", 64), text(formData, "price", 20), { confirmBelowNet: formData.get(CONFIRM.belowNet.name) === "on" }));
}

export async function roomDateAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await setClientCancelDate(userId, agencyId, text(formData, "roomId", 64), text(formData, "date", 10)));
}

export async function removeRoomAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  return done(await removeRoom(userId, agencyId, text(formData, "roomId", 64)));
}

// "Add to quote" on the hotel page (screen 09): the rate is named by the search, the room and the
// bed type; everything else is read on the server.
export async function addToQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const result = await addFromSearch(userId, agencyId, {
    quoteId: text(formData, "quoteId", 64),
    snapshotId: text(formData, "s", 64),
    propertyId: text(formData, "p", 64),
    rateId: text(formData, "r", 128),
    bedGroupId: text(formData, "b", 128),
  });
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath(`/quotes/${result.id}`);
  revalidatePath("/quotes");
  return { status: "success", message: "Added to the quote.", quoteId: result.id };
}

// ---------- sending (plan 5c) ----------

// `confirm`: nothing was sent; the panel asks "send at cost price?" and calls again with the yes.
export type SendState = { ok: true; url?: string; message?: string } | { ok: false; error: string; confirm?: "netPrice" };

export async function copyLinkAction(quoteId: string, confirmNetPrice?: boolean): Promise<SendState> {
  const { userId, agencyId } = await requireAgent();
  const result = await shareLink(userId, agencyId, String(quoteId).slice(0, 64), "link", { confirmNetPrice: confirmNetPrice === true });
  if (!result.ok) return result;
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { ok: true, url: result.url };
}

export async function whatsappAction(quoteId: string, confirmNetPrice?: boolean): Promise<SendState> {
  const { userId, agencyId } = await requireAgent();
  const result = await whatsappLink(userId, agencyId, String(quoteId).slice(0, 64), { confirmNetPrice: confirmNetPrice === true });
  if (!result.ok) return result;
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { ok: true, url: result.url };
}

export async function emailAction(quoteId: string, confirmNetPrice?: boolean): Promise<SendState> {
  const { userId, agencyId } = await requireAgent();
  const result = await emailQuote(userId, agencyId, String(quoteId).slice(0, 64), { confirmNetPrice: confirmNetPrice === true });
  if (!result.ok) return result;
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/quotes");
  return { ok: true, message: "Email sent to the client." };
}

// What "Send by email" will send (the dialog shows it before the agent sends).
export async function emailPreviewAction(quoteId: string): Promise<EmailPreview> {
  const { userId, agencyId } = await requireAgent();
  const result = await emailPreview(userId, agencyId, String(quoteId).slice(0, 64));
  if (result.ok) revalidatePath(`/quotes/${quoteId}`);
  return result;
}

// A new client link: the old one stops working at once (a link sent to the wrong person).
export async function renewLinkAction(quoteId: string): Promise<SendState> {
  const { userId, agencyId } = await requireAgent();
  const result = await renewLink(userId, agencyId, String(quoteId).slice(0, 64));
  if (!result.ok) return result;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true, url: result.url };
}

// ---------- booking from the quote (plan 5d) ----------

// "Book this room": the hotel is searched again and the guest details page opens for that rate,
// with this destination, so the booking is linked to the quote. The price is checked as usual.
export async function bookFromQuoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, agencyId } = await requireAgent();
  const stayId = text(formData, "stayId", 64);
  const result = await prepareQuoteBooking({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, stayId);
  // The picked room is gone but the hotel has others: the destination and the client's pick stay,
  // and the agent chooses another room of the same hotel on the next page.
  if (!result.ok && result.rooms) redirect(`/quotes/${result.rooms.quoteId}/rooms/${stayId}?s=${encodeURIComponent(result.rooms.snapshotId)}`);
  if (!result.ok) return { status: "error", message: result.error };
  const query = new URLSearchParams({ ...result.rate, stay: stayId });
  redirect(`/book/new?${query.toString()}`);
}

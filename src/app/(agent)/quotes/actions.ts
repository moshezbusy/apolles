"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import {
  addFromSearch,
  addStay,
  createQuote,
  moveHotel,
  removeHotel,
  removeRoom,
  removeStay,
  setClientCancelDate,
  setRoomPrice,
  toggleAgencyPick,
  updateQuoteSettings,
  type Result,
} from "@/server/quotes/quotes";
import type { ActionState } from "./action-state";

// Quote actions (screens 09, 14, 15). Each one checks the agent session itself and passes the
// agencyId from it; an agencyId in the form is never read. Ids from the form (quote, destination,
// hotel, room) are only used together with that agencyId, so another agency's id finds nothing.

function text(formData: FormData, key: string, max = 100): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max) : "";
}

function done(result: Result, message?: string): ActionState {
  if (!result.ok) return { status: "error", message: result.error };
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
  });
  return done(result, "Changes saved.");
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
  return done(await setRoomPrice(userId, agencyId, text(formData, "roomId", 64), text(formData, "price", 20)));
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

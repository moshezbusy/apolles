"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { addCompanion, createClient, findSimilarClient, removeCompanion, updateClient } from "@/server/clients";
import type { ClientFormState } from "./form-state";

// Client actions (screen 18). Each one checks the agent session itself and passes the agencyId
// from it; an agencyId in the form is never read. A clientId or companionId from the form is only
// used together with that agencyId, so another agency's id finds nothing.

function text(formData: FormData, key: string, max = 1100): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max) : "";
}

const CLIENT_ERROR =
  "Check the form: first and last name, a WhatsApp phone with 7 to 15 digits, a valid email or none, a nationality, and notes up to 1,000 characters.";

function clientFields(formData: FormData) {
  return {
    firstName: text(formData, "firstName", 100),
    lastName: text(formData, "lastName", 100),
    phone: text(formData, "phone", 100),
    email: text(formData, "email", 300),
    nationality: text(formData, "nationality", 10),
    notes: text(formData, "notes"),
  };
}

export async function createClientAction(_previous: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = clientFields(formData);
  // The same person twice: warn once, with a link to the card that exists. Saving again (the form
  // then sends confirmDuplicate) adds the new card anyway.
  if (formData.get("confirmDuplicate") !== "1") {
    const same = await findSimilarClient(agencyId, values);
    if (same) {
      return {
        status: "error",
        message: `${same.firstName} ${same.lastName} already has this email or phone. Open that client, or choose Save client again to add a new one.`,
        values,
        duplicate: { id: same.id, name: `${same.firstName} ${same.lastName}` },
      };
    }
  }
  const result = await createClient(userId, agencyId, values);
  if (!result.ok) return { status: "error", message: CLIENT_ERROR, values };
  revalidatePath("/clients");
  redirect(`/clients?id=${encodeURIComponent(result.id)}`);
}

export async function updateClientAction(_previous: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const { userId, agencyId } = await requireAgent();
  const clientId = text(formData, "clientId", 50);
  const values = clientFields(formData);
  const result = await updateClient(userId, agencyId, clientId, values);
  if (!result.ok) return { status: "error", message: CLIENT_ERROR, values };
  revalidatePath("/clients");
  redirect(`/clients?id=${encodeURIComponent(clientId)}`);
}

export async function addCompanionAction(_previous: ClientFormState, formData: FormData): Promise<ClientFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = {
    firstName: text(formData, "firstName", 100),
    lastName: text(formData, "lastName", 100),
    relation: text(formData, "relation", 100),
    childAge: text(formData, "childAge", 5),
  };
  const result = await addCompanion(userId, agencyId, text(formData, "clientId", 50), values);
  if (!result.ok) {
    return { status: "error", message: "Check the companion: first and last name, and for a child an age from 0 to 17.", values };
  }
  revalidatePath("/clients");
  return { status: "success", message: "Companion added." };
}

export async function removeCompanionAction(formData: FormData): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  await removeCompanion(userId, agencyId, text(formData, "companionId", 50));
  revalidatePath("/clients");
}

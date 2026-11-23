"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAPPING_NOTE_MAX, decideHotelMapping, proposeHotelMapping, removeHotelMapping } from "@/server/admin/hotel-mapping";
import { requireAdmin } from "@/server/auth/guards";
import type { MappingFormState } from "./form-state";

// The hotel mapping page's actions. Each one checks the admin session (with its TOTP step) first;
// the service writes the change and its audit row in one transaction.

const PAGE = "/admin/hotel-mapping";
const mappingId = z.string().min(1).max(40);

export async function proposeMappingAction(_previous: MappingFormState, formData: FormData): Promise<MappingFormState> {
  const { userId } = await requireAdmin();
  try {
    switch (await proposeHotelMapping(userId, { propertyId: formData.get("propertyId"), layerHotelId: formData.get("layerHotelId"), note: formData.get("note") ?? "" })) {
      case "added":
        return { status: "success", message: "Link proposed. Approve it in the list below to search this hotel with Hotelbeds." };
      case "invalid":
        return { status: "error", message: `Enter the supplier layer hotel id (letters, digits, "-" or "_") and a note under ${MAPPING_NOTE_MAX} characters.` };
      case "property_not_found":
        return { status: "error", message: "This hotel was not found. Search for it again." };
      case "property_linked":
        return { status: "error", message: "This hotel already has a link. Remove that link first to link it to another hotel id." };
      case "layer_hotel_linked":
        return { status: "error", message: "This supplier layer hotel id is already linked to another hotel. Remove that link first." };
    }
  } finally {
    revalidatePath(PAGE, "page");
  }
}

export async function decideMappingAction(_previous: MappingFormState, formData: FormData): Promise<MappingFormState> {
  const { userId } = await requireAdmin();
  const parsed = z.object({ mappingId, decision: z.enum(["approve", "reject"]) }).safeParse({ mappingId: formData.get("mappingId"), decision: formData.get("decision") });
  if (!parsed.success) return { status: "error", message: "Reload the page and try again." };
  try {
    switch (await decideHotelMapping(userId, parsed.data.mappingId, parsed.data.decision)) {
      case "approved":
        return { status: "success", message: "Link approved. The next searches include this hotel's Hotelbeds rates." };
      case "rejected":
        return { status: "success", message: "Link rejected. This hotel is not searched with Hotelbeds." };
      case "unchanged":
        return { status: "info", message: "Nothing changed: the link already had this status." };
      case "not_found":
        return { status: "error", message: "This link was not found. Reload the page." };
    }
  } finally {
    revalidatePath(PAGE, "page");
  }
}

export async function removeMappingAction(_previous: MappingFormState, formData: FormData): Promise<MappingFormState> {
  const { userId } = await requireAdmin();
  const parsed = z.object({ mappingId, confirm: z.literal("yes") }).safeParse({ mappingId: formData.get("mappingId"), confirm: formData.get("confirm") });
  if (!parsed.success) return { status: "error", message: "Tick the box to confirm, then remove the link." };
  try {
    return (await removeHotelMapping(userId, parsed.data.mappingId)) === "removed"
      ? { status: "success", message: "Link removed. This hotel is not searched with Hotelbeds." }
      : { status: "error", message: "This link was not found. Reload the page." };
  } finally {
    revalidatePath(PAGE, "page");
  }
}

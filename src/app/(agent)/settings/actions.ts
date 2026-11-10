"use server";

import { revalidatePath } from "next/cache";
import {
  LOGO_MAX_BYTES,
  LOGO_RULE_COPY,
  agencyProfileInput,
  removeAgencyLogo,
  setAgencyLogo,
  updateAgencyProfile,
} from "@/server/agency-profile";
import { requireAgent } from "@/server/auth/guards";
import type { SettingsFormState } from "./form-state";

// Agent settings actions. Each one checks the agent session itself and uses the agencyId
// from it; an agencyId sent in the form is never read.

const PROFILE_ERROR =
  "Check the form: agency name 2–100 characters, a valid business email, a phone number with 7–15 digits, and a country.";

export async function updateProfileAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();

  // Only the known fields are read (the form also carries Next.js internals).
  const parsed = agencyProfileInput.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    country: formData.get("country"),
  });
  if (!parsed.success) return { status: "error", message: PROFILE_ERROR };

  await updateAgencyProfile(userId, agencyId, parsed.data);
  revalidatePath("/", "layout"); // the header shows the agency name
  return { status: "success", message: "Changes saved." };
}

export async function uploadLogoAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();

  const file = formData.get("logo");
  if (!(file instanceof Blob) || file.size === 0) return { status: "error", message: "Choose an image file." };
  // Checked before reading the file into memory.
  if (file.size > LOGO_MAX_BYTES) return { status: "error", message: `The file is too large. ${LOGO_RULE_COPY}` };

  const result = await setAgencyLogo(userId, agencyId, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return { status: "error", message: result.error };
  revalidatePath("/settings");
  return { status: "success", message: "Logo saved." };
}

export async function removeLogoAction(): Promise<void> {
  const { userId, agencyId } = await requireAgent();
  await removeAgencyLogo(userId, agencyId);
  revalidatePath("/settings");
}

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
import { headers } from "next/headers";
import { requireAgent } from "@/server/auth/guards";
import { requestResetWithinLimits } from "@/server/auth/password-tokens";
import { getClientIp } from "@/server/client-ip";
import { updateQuoteBranding, updateQuoteDefaults } from "@/server/quote-settings";
import { getAccount } from "@/server/users";
import type { SettingsFormState } from "./form-state";

// Agent settings actions. Each one checks the agent session itself and uses the agencyId
// from it; an agencyId sent in the form is never read.

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.slice(0, 300) : "";
}

const PROFILE_ERROR = "Check the form: a valid business email and a phone number with 7–15 digits.";

export async function updateProfileAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();

  // Only the fields an agent may change are read (the form also carries Next.js internals).
  // The agency name and country are never read: an agent cannot change them (agency-profile.ts).
  const submitted = {
    email: text(formData.get("email")),
    phone: text(formData.get("phone")),
  };
  const parsed = agencyProfileInput.safeParse(submitted);
  if (!parsed.success) return { status: "error", message: PROFILE_ERROR, values: submitted };

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
  // Next has already read the request body (at most 1 MB, its server-action limit); the
  // form also checks the size in the browser before sending, so bigger files never get here.
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

// ---------- quote branding, preferences, account (screen 20 tabs) ----------

const BRANDING_FIELDS = ["displayName", "advisorName", "contactPhone", "advisorEmail", "defaultLanguage", "brandColor", "defaultMessage"];

export async function updateBrandingAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();
  // Only the known fields are read (the form also carries Next.js internals).
  const values: Record<string, string> = {};
  for (const key of BRANDING_FIELDS) {
    const value = formData.get(key);
    values[key] = typeof value === "string" ? value.slice(0, key === "defaultMessage" ? 1200 : 300) : "";
  }
  const result = await updateQuoteBranding(userId, agencyId, values);
  if (!result.ok) return { status: "error", message: result.error, values };
  revalidatePath("/settings");
  return { status: "success", message: "Changes saved." };
}

export async function updateDefaultsAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();
  const values = { markupType: text(formData.get("markupType")), markupValue: text(formData.get("markupValue")), showCancellation: formData.get("showCancellation") === "on" ? "on" : "" };
  const result = await updateQuoteDefaults(userId, agencyId, { markupType: values.markupType, markupValue: values.markupValue, showCancellation: values.showCancellation === "on" });
  if (!result.ok) return { status: "error", message: result.error, values };
  revalidatePath("/settings");
  return { status: "success", message: "Changes saved." };
}

// "Change password": a link to set a new one is emailed to the agent's own login email, with the
// same limits as "Forgot password". The answer is the same either way.
export async function changePasswordAction(): Promise<SettingsFormState> {
  const { userId, agencyId } = await requireAgent();
  const account = await getAccount(userId, agencyId);
  if (account) await requestResetWithinLimits(account.email, getClientIp(await headers()));
  return { status: "success", message: "We emailed you a link to set a new password. It works for 1 hour." };
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guards";
import {
  AgencyNotFoundError,
  DUPLICATE_EMAIL_MESSAGE,
  createAgency,
  createAgencyInput,
  setAgencyStatus,
} from "@/server/admin/agencies";
import type { CreateAgencyState } from "./form-state";

const LIST = "/admin/agencies";

const EMAIL_FAILED_COPY =
  "Agency created, but the email could not be sent. Ask the agent to use “Forgot password” on the sign-in page to get a link.";

const statusInput = z
  .object({ agencyId: z.string().min(1).max(100), status: z.enum(["ACTIVE", "SUSPENDED"]) })
  .strict();

export async function createAgencyAction(
  _previous: CreateAgencyState,
  formData: FormData,
): Promise<CreateAgencyState> {
  const { userId } = await requireAdmin();

  // Only the known fields are read (the form also carries Next.js internals).
  const parsed = createAgencyInput.safeParse({
    name: formData.get("name"),
    country: formData.get("country"),
    agentName: formData.get("agentName"),
    agentEmail: formData.get("agentEmail"),
  });
  if (!parsed.success) {
    return {
      error:
        "Check the form: agency name 2–100 characters, country as a 2-letter code (e.g. IL), agent name, and a valid agent email.",
    };
  }

  let emailSent: boolean;
  try {
    ({ emailSent } = await createAgency(userId, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === DUPLICATE_EMAIL_MESSAGE) {
      return { error: DUPLICATE_EMAIL_MESSAGE };
    }
    throw error;
  }
  if (!emailSent) return { error: EMAIL_FAILED_COPY, created: true };
  redirect(LIST);
}

// Suspend / reactivate, posted from the confirm page.
export async function setAgencyStatusAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();

  const parsed = statusInput.safeParse({
    agencyId: formData.get("agencyId"),
    status: formData.get("status"),
  });
  if (!parsed.success) redirect(LIST);

  try {
    await setAgencyStatus(userId, parsed.data.agencyId, parsed.data.status);
  } catch (error) {
    if (!(error instanceof AgencyNotFoundError)) throw error;
  }
  redirect(LIST);
}

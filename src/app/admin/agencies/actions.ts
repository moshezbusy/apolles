"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guards";
import {
  AgencyNotFoundError,
  DUPLICATE_EMAIL_MESSAGE,
  createAgency,
  createAgencyInput,
  resendSetupEmail,
  setAgencyStatus,
  type ResendSetupResult,
} from "@/server/admin/agencies";
import type { CreateAgencyState, SetupEmailState } from "./form-state";

const LIST = "/admin/agencies";

const EMAIL_FAILED_COPY =
  "Agency created, but the email could not be sent. Open the agency from the list and choose “Send the set-up email again”.";

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

const SETUP_EMAIL_COPY: Record<ResendSetupResult, NonNullable<SetupEmailState>> = {
  SENT: { status: "success", message: "The set-up email was sent. The link works for 72 hours." },
  ALREADY_SET: { status: "error", message: "This agent has already set a password. They can use “Forgot password” on the sign-in page." },
  SUSPENDED: { status: "error", message: "This agency is suspended. Reactivate it, then send the set-up email." },
  NOT_FOUND: { status: "error", message: "This agency was not found." },
  LIMITED: { status: "error", message: "Too many set-up emails for this agency. Try again in an hour." },
  FAILED: { status: "error", message: "The email could not be sent. Try again in a few minutes." },
};

// "Send the set-up email again" on the agency page: a fresh invitation link for an agent who
// has not set a password yet. The service checks the agency, limits and audits.
export async function resendSetupEmailAction(_previous: SetupEmailState, formData: FormData): Promise<SetupEmailState> {
  const { userId } = await requireAdmin();
  const agencyId = formData.get("agencyId");
  if (typeof agencyId !== "string") return SETUP_EMAIL_COPY.NOT_FOUND;
  return SETUP_EMAIL_COPY[await resendSetupEmail(userId, agencyId)];
}

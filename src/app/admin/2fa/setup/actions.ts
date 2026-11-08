"use server";

import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { confirmTotpForSession, startTotpEnrollment } from "@/server/auth/totp";
import { TOTP_WRONG_COPY, parseCode, respondToTotpCheck } from "../code-result";
import type { TotpFormState } from "../form-state";

// First admin sign-in: the code proves the authenticator app has the key. Confirms TOTP
// and verifies this session in one step.
export async function confirmTotpAction(
  _previous: TotpFormState,
  formData: FormData,
): Promise<TotpFormState> {
  const { sessionId, totpConfirmed } = await requireAdminPendingTotp();
  if (totpConfirmed) redirect("/admin/2fa");

  const code = parseCode(formData);
  if (code === null) return { error: TOTP_WRONG_COPY };
  return respondToTotpCheck(await confirmTotpForSession(sessionId, code));
}

// "Generate a new key" button: replaces the unconfirmed key (e.g. the old one was lost or
// added wrongly), then shows the setup page again with the new key.
export async function regenerateTotpKeyAction(): Promise<void> {
  const { userId, totpConfirmed } = await requireAdminPendingTotp();
  if (totpConfirmed) redirect("/admin/2fa");
  await startTotpEnrollment(userId, { regenerate: true });
  redirect("/admin/2fa/setup");
}

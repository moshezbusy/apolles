"use server";

import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { confirmTotpForSession } from "@/server/auth/totp";
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

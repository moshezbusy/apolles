"use server";

import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { checkTotpForSession } from "@/server/auth/totp";
import { TOTP_WRONG_COPY, parseCode, respondToTotpCheck } from "./code-result";
import type { TotpFormState } from "./form-state";

// Sign-in step 2 for admins: the code from the authenticator app verifies this session.
export async function verifyTotpAction(
  _previous: TotpFormState,
  formData: FormData,
): Promise<TotpFormState> {
  const { sessionId, totpConfirmed } = await requireAdminPendingTotp();
  if (!totpConfirmed) redirect("/admin/2fa/setup");

  const code = parseCode(formData);
  if (code === null) return { error: TOTP_WRONG_COPY };
  return respondToTotpCheck(await checkTotpForSession(sessionId, code));
}

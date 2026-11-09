"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { getClientIp } from "@/server/client-ip";
import { SIGN_IN_RATE_LIMIT_COPY, hitIpRateLimit } from "@/server/rate-limit";
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

  // Per-IP limit before the code is looked at: a refused request takes no attempt slot.
  // Not the account lockout, so this session is kept and may try again later.
  const { allowed } = await hitIpRateLimit("totp", getClientIp(await headers()));
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

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

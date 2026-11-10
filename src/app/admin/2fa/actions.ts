"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { getClientIp } from "@/server/client-ip";
import { SIGN_IN_RATE_LIMIT_COPY, hitIpRateLimit } from "@/server/rate-limit";
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

  // Per-IP limit before the code is looked at: a refused request takes no attempt slot.
  // Not the account lockout, so this session is kept and may try again later.
  const { allowed } = await hitIpRateLimit("totp", getClientIp(await headers()));
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

  const code = parseCode(formData);
  if (code === null) return { error: TOTP_WRONG_COPY };
  return respondToTotpCheck(await checkTotpForSession(sessionId, code));
}

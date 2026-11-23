"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { renewSessionCookie, requireAdminPendingTotp } from "@/server/auth/guards";
import { getClientIp } from "@/server/client-ip";
import { SIGN_IN_RATE_LIMIT_COPY, hitIpRateLimit } from "@/server/rate-limit";
import { checkTotpForSession } from "@/server/auth/totp";
import { checkRecoveryCodeForSession } from "@/server/auth/recovery-codes";
import { TOTP_WRONG_COPY, parseCode, rememberAdminBrowser, respondToTotpCheck } from "./code-result";
import type { TotpFormState } from "./form-state";

// Sign-in step 2 for admins: the code from the authenticator app verifies this session.
export async function verifyTotpAction(
  _previous: TotpFormState,
  formData: FormData,
): Promise<TotpFormState> {
  const { userId, sessionId, totpConfirmed } = await requireAdminPendingTotp();
  if (!totpConfirmed) redirect("/admin/2fa/setup");

  // Per-IP limit before the code is looked at: a refused request takes no attempt slot.
  // Not the account lockout, so this session is kept and may try again later.
  const { allowed } = await hitIpRateLimit("totp", getClientIp(await headers()));
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

  const code = parseCode(formData);
  if (code === null) return { error: TOTP_WRONG_COPY };
  const result = await checkTotpForSession(sessionId, code);
  // Fully signed in now: the session gets a new token; the one from before the code stops working.
  if (result === "OK") {
    await renewSessionCookie(sessionId);
    await rememberAdminBrowser(userId);
  }
  return respondToTotpCheck(result);
}

const RECOVERY_WRONG_COPY = "That recovery code is not right, or it was already used. Check it and try again.";

// Sign-in step 2 with a recovery code, for an admin who lost the phone with the authenticator.
// Same per-IP limit and second-step counter as the 6-digit code. A right code is used up, and
// the admin goes on to the security page, where they can make new codes.
export async function verifyRecoveryCodeAction(
  _previous: TotpFormState,
  formData: FormData,
): Promise<TotpFormState> {
  const { userId, sessionId, totpConfirmed } = await requireAdminPendingTotp();
  if (!totpConfirmed) redirect("/admin/2fa/setup");

  const { allowed } = await hitIpRateLimit("totp", getClientIp(await headers()));
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

  const raw = formData.get("recoveryCode");
  if (typeof raw !== "string" || raw.length > 40) return { error: RECOVERY_WRONG_COPY };
  const result = await checkRecoveryCodeForSession(sessionId, raw);
  if (result === "OK") {
    await renewSessionCookie(sessionId);
    await rememberAdminBrowser(userId);
  }
  if (result === "WRONG") return { error: RECOVERY_WRONG_COPY };
  return respondToTotpCheck(result, "/admin/security");
}

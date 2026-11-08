"use server";

import { after } from "next/server";
import { z } from "zod";
import { requestReset } from "@/server/auth/password-tokens";

export type ForgotPasswordState = { sent: true } | null;

const forgotPasswordInput = z.object({ email: z.string().trim().min(1).max(254) }).strict();

// "Forgot password" form handler. The answer is always the same, and the lookup and email
// run after the response is sent, so neither the reply nor its timing reveals whether the
// email has an account. Never logs the email.
export async function requestResetAction(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordInput.safeParse({ email: formData.get("email") });
  if (parsed.success) {
    const { email } = parsed.data;
    after(() => requestReset(email));
  }
  return { sent: true };
}

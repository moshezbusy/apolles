"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PASSWORDS_DIFFER_COPY, PASSWORD_RULE_COPY } from "@/lib/password-rule";
import { consumePasswordToken } from "@/server/auth/password-tokens";
import { getClientIp } from "@/server/client-ip";
import { SET_PASSWORD_RATE_LIMIT_COPY, hitIpRateLimit } from "@/server/rate-limit";

export type SetPasswordState = { status: "expired" } | { error: string } | null;

// Generous bounds only to reject junk early; the password rule itself is checked by
// consumePasswordToken (it allows at most PASSWORD_MAX_LENGTH characters).
const setPasswordInput = z
  .object({
    token: z.string().min(1).max(128),
    password: z.string().max(1024),
    confirm: z.string().max(1024),
  })
  .strict();

// Set-password / reset form handler. The token alone decides whose password changes.
// Never logs the token or the password.
export async function setPasswordAction(
  _previous: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  // Per-IP limit first (link guessing): a refused submit does not look at the token, so the
  // link is not used up.
  const { allowed } = await hitIpRateLimit("set-password", getClientIp(await headers()));
  if (!allowed) return { error: SET_PASSWORD_RATE_LIMIT_COPY };

  const parsed = setPasswordInput.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { status: "expired" };
  const { token, password, confirm } = parsed.data;
  if (password !== confirm) return { error: PASSWORDS_DIFFER_COPY };

  const result = await consumePasswordToken(token, password);
  if (result === "INVALID_PASSWORD") return { error: PASSWORD_RULE_COPY };
  if (result === "EXPIRED") return { status: "expired" };
  redirect("/login?reset=1");
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { PASSWORDS_DIFFER_COPY, PASSWORD_RULE_COPY } from "@/lib/password-rule";
import { consumePasswordToken } from "@/server/auth/password-tokens";

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

"use server";

import { z } from "zod";
import { requireAdmin } from "@/server/auth/guards";
import { RecoveryCodesNotAllowed, createRecoveryCodes } from "@/server/auth/recovery-codes";
import { checkTotpCode } from "@/server/auth/totp";
import { TOTP_LOCKED_COPY, TOTP_WRONG_COPY } from "../2fa/code-result";
import { freshlySignedIn } from "./fresh";
import type { RecoveryFormState } from "./form-state";

const fields = z.object({ code: z.string().max(20).nullable() }).strict();

// "Make recovery codes": a new set of 10; the old set stops working. Never logs a code.
export async function createRecoveryCodesAction(_previous: RecoveryFormState, formData: FormData): Promise<RecoveryFormState> {
  const { userId } = await requireAdmin();
  const parsed = fields.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { status: "error", message: TOTP_WRONG_COPY };
  if (!(await freshlySignedIn())) {
    const code = (parsed.data.code ?? "").replace(/\s/g, "");
    const checked = await checkTotpCode(userId, code);
    if (checked === "LOCKED") return { status: "error", message: TOTP_LOCKED_COPY };
    if (checked !== "OK") return { status: "error", message: "Enter the 6-digit code from your authenticator app to make new codes." };
  }
  try {
    const codes = await createRecoveryCodes(userId);
    return { status: "success", message: "Your new recovery codes. Save them now: they are shown only once.", codes };
  } catch (caught) {
    if (caught instanceof RecoveryCodesNotAllowed) return { status: "error", message: "Set up your authenticator app first, then make recovery codes." };
    throw caught;
  }
}

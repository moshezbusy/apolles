import { redirect } from "next/navigation";
import { z } from "zod";
import { LOGIN_ERROR_COPY } from "@/server/auth/login";
import { endCurrentSession } from "@/server/auth/guards";
import type { TotpCheckResult } from "@/server/auth/totp";
import type { TotpFormState } from "./form-state";

export const TOTP_WRONG_COPY = "Wrong code. Try again.";

// The only field of both TOTP forms: exactly 6 digits, nothing else accepted.
const codeInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

export function parseCode(formData: FormData): string | null {
  const parsed = codeInput.safeParse({ code: formData.get("code") });
  return parsed.success ? parsed.data.code : null;
}

// What the browser gets for each outcome of a TOTP check. Never logs the code.
export async function respondToTotpCheck(result: TotpCheckResult): Promise<TotpFormState> {
  switch (result) {
    case "OK":
      redirect("/admin");
    case "LOCKED":
      // A lock by this code already ended every session of the admin; a lock from earlier
      // wrong passwords did not, so end this one here.
      await endCurrentSession();
      return { error: LOGIN_ERROR_COPY.LOCKED, locked: true };
    case "WRONG":
      return { error: TOTP_WRONG_COPY };
    case "UNAVAILABLE":
      // The session or TOTP state changed meanwhile; the admin guard sends them on.
      redirect("/admin");
  }
}

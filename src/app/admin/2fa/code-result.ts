import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endCurrentSession } from "@/server/auth/guards";
import { DEVICE_COOKIE, DEVICE_TTL_MS, isTrustedDevice, trustDevice } from "@/server/auth/signin-code";
import type { TotpCheckResult } from "@/server/auth/totp";
import type { TotpFormState } from "./form-state";

export const TOTP_WRONG_COPY = "Wrong code. Try again.";
// The second step is locked for 15 minutes (lockout-policy.ts). A password reset does not lift
// it (R36), so the copy does not offer one.
export const TOTP_LOCKED_COPY = "Too many wrong codes. Wait 15 minutes, then sign in again.";

// The only field of both TOTP forms: exactly 6 digits, nothing else accepted.
const codeInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

export function parseCode(formData: FormData): string | null {
  const parsed = codeInput.safeParse({ code: formData.get("code") });
  return parsed.success ? parsed.data.code : null;
}

// After a complete admin sign-in: this browser is remembered (device cookie, 90 days, like an
// agent's). It never skips the authenticator code; it only gives this browser its own pool of
// password attempts, so wrong passwords from elsewhere cannot keep the admin out (lockout.ts).
export async function rememberAdminBrowser(userId: string): Promise<void> {
  const cookieStore = await cookies();
  if (await isTrustedDevice(userId, cookieStore.get(DEVICE_COOKIE)?.value)) return;
  cookieStore.set(DEVICE_COOKIE, await trustDevice(userId), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: DEVICE_TTL_MS / 1000 });
}

// What the browser gets for each outcome of a TOTP check. Never logs the code.
// `next`: where a right code goes (the setup page sends a new admin on to the recovery codes).
export async function respondToTotpCheck(result: TotpCheckResult, next = "/admin"): Promise<TotpFormState> {
  switch (result) {
    case "OK":
      redirect(next);
    case "LOCKED":
      // A lock by this code already ended every session of the admin; a lock that was already
      // there (earlier wrong codes, or a stuck attempt) may not have, so end this one here.
      await endCurrentSession();
      return { error: TOTP_LOCKED_COPY, locked: true };
    case "WRONG":
      return { error: TOTP_WRONG_COPY };
    case "UNAVAILABLE":
      // The session or TOTP state changed meanwhile; the admin guard sends them on.
      redirect("/admin");
  }
}

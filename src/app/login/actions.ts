"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LOGIN_ERROR_COPY, login } from "@/server/auth/login";
import { PASSWORD_MAX_LENGTH } from "@/server/auth/password";
import { getClientIp } from "@/server/client-ip";
import { SIGN_IN_RATE_LIMIT_COPY, hitIpRateLimit } from "@/server/rate-limit";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  getSession,
} from "@/server/auth/session";
import { completeSignIn } from "@/server/auth/lockout";
import { DEVICE_COOKIE, isTrustedDevice, sendSignInCode } from "@/server/auth/signin-code";
import { isDemoAgentWithoutCode } from "@/server/content/demo-seed";

export type LoginFormState = { error: string } | null;

const loginInput = z
  .object({
    email: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

// Sign-in form handler. Never logs the email or password.
export async function loginAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  // Per-IP limit first: a refused request never reaches the account (no attempt slot, no
  // change to failedLogins, no password check).
  const { allowed } = await hitIpRateLimit("signin", getClientIp(await headers()));
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

  const parsed = loginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: LOGIN_ERROR_COPY.INVALID };

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: LOGIN_ERROR_COPY[result.reason] };

  const cookieStore = await cookies();
  // A new sign-in always gets a fresh token; the old session from this browser is ended.
  const previousToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (previousToken) await destroySession(previousToken);

  // Plan 8e: an agent on a device Apolles does not know must enter an email code first.
  // The staging demo agent counts as a known device (demo-seed.ts).
  const knownDevice =
    !result.needsTotp &&
    ((await isTrustedDevice(result.userId, cookieStore.get(DEVICE_COOKIE)?.value)) || (await isDemoAgentWithoutCode(result.userId)));
  // A known agent device completes the sign-in now (the run of failures is over).
  if (knownDevice && !(await completeSignIn(result.userId))) return { error: LOGIN_ERROR_COPY.LOCKED };
  // Admins: verified here (their second step is TOTP, checked by requireAdmin).
  const token = await createSession(result.userId, { verified: result.needsTotp || knownDevice });
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });

  if (!result.needsTotp && !knownDevice) {
    const session = await getSession(token);
    if (session) await sendSignInCode(session.sessionId);
    redirect("/login/verify");
  }
  // Admins continue to the admin area (TOTP step is added with admin TOTP).
  redirect(result.needsTotp ? "/admin" : "/search");
}

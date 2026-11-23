"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LOGIN_ERROR_COPY, login } from "@/server/auth/login";
import { PASSWORD_MAX_LENGTH } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { getClientIp } from "@/server/client-ip";
import { SIGN_IN_RATE_LIMIT_COPY, hitIpRateLimit, refundIpRateLimit } from "@/server/rate-limit";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSession,
  sessionCookieOptions,
} from "@/server/auth/session";
import { completeSignIn } from "@/server/auth/lockout";
import { DEVICE_COOKIE, isTrustedDevice, sendSignInCode } from "@/server/auth/signin-code";
import { isDemoAgentWithoutCode } from "@/server/content/demo-seed";
import { AFTER_SIGN_IN_PATH, afterSignInPath } from "@/lib/return-path";
import { CODE_NOT_SENT_COPY } from "./verify/copy";

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
  // The page the agent was on when the session ended (only a safe path on this site).
  const next = afterSignInPath(formData.get("next"));

  // Per-IP limit first: a refused request never reaches the account (no attempt slot, no
  // change to failedLogins, no password check). Every request is counted here, before the
  // check; a right password hands its count back below, so only failed attempts add up and an
  // office that shares one address is not shut out by its own normal sign-ins.
  const ip = getClientIp(await headers());
  const { allowed } = await hitIpRateLimit("signin", ip);
  if (!allowed) return { error: SIGN_IN_RATE_LIMIT_COPY };

  const parsed = loginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: LOGIN_ERROR_COPY.INVALID };

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: LOGIN_ERROR_COPY[result.reason] };
  await refundIpRateLimit("signin", ip);

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

  if (!result.needsTotp && !knownDevice) {
    // The code goes out before the browser gets the session: when it cannot be sent (mail
    // provider down, or too many codes this hour) the half-made session is removed and the
    // agent is told the truth here, instead of landing on a page that says "we sent a code".
    const session = await getSession(token);
    const sent = session ? await sendSignInCode(session.sessionId) : "failed";
    if (sent !== "sent") {
      await destroySession(token);
      // A fresh session cannot be "gone" or over its own cap: anything else is a failed send.
      return { error: CODE_NOT_SENT_COPY[sent === "limited-hour" ? "limited-hour" : "failed"] };
    }
  }
  // An agent on a known device is signed in now: audited here. A new device is audited when
  // its email code is right (signin-code.ts), an admin when the TOTP code is (totp.ts).
  if (knownDevice) await audit(result.userId, "user.sign-in", "User", result.userId, undefined, { secondStep: "known-device" });
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions());

  // The email-code step carries the return page on, so the agent still lands there after it.
  if (!result.needsTotp && !knownDevice) redirect(next === AFTER_SIGN_IN_PATH ? "/login/verify" : `/login/verify?next=${encodeURIComponent(next)}`);
  // Admins continue to the admin area (TOTP step is added with admin TOTP).
  redirect(result.needsTotp ? "/admin" : next);
}

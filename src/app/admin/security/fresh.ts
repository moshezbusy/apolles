import { cookies } from "next/headers";
import { SESSION_COOKIE, getSession } from "@/server/auth/session";

// Within this long after this session's sign-in code, no new code is asked for (right after
// setting up the authenticator, or signing in with a recovery code). Later, the authenticator
// code is asked for again: someone at an unlocked admin browser must not make codes for later.
export const FRESH_SIGN_IN_MS = 10 * 60_000;

export async function freshlySignedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await getSession(token) : null;
  return !!session?.totpVerifiedAt && Date.now() - session.totpVerifiedAt.getTime() < FRESH_SIGN_IN_MS;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  destroySession,
  getSession,
  type SessionContext,
} from "@/server/auth/session";

async function currentSession(): Promise<SessionContext | null> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;
  return getSession(rawToken);
}

// Where to send someone without a valid session: a browser that still holds a session cookie
// had a session that ended (12 hours, sign-out elsewhere, suspension), so the sign-in page
// says "you were signed out" (screen 24). No cookie: the plain sign-in page.
async function signInPath(): Promise<string> {
  return (await cookies()).get(SESSION_COOKIE)?.value ? "/login?expired=1" : "/login";
}

// For every agent page and server action. The agencyId comes only from the session,
// never from the request. Anyone else (no session, expired, suspended, admin) goes to /login.
export async function requireAgent(): Promise<{ userId: string; agencyId: string }> {
  const session = await currentSession();
  if (!session) redirect(await signInPath());
  if (session.user.role !== "AGENT" || !session.agency) redirect("/login");
  return { userId: session.user.id, agencyId: session.agency.id };
}

// For every admin page and server action (each one calls it itself; the /admin layout
// does not, because the 2fa pages live under /admin too). Passes only a valid session of
// an ADMIN user whose TOTP is set up and was entered for THIS session.
//   no session / not an admin  → /login
//   TOTP not set up yet        → /admin/2fa/setup
//   code not entered yet       → /admin/2fa
export async function requireAdmin(): Promise<{ userId: string }> {
  const session = await currentSession();
  if (!session) redirect(await signInPath());
  if (session.user.role !== "ADMIN") redirect("/login");
  if (!session.user.totpConfirmedAt) redirect("/admin/2fa/setup");
  if (!session.totpVerifiedAt) redirect("/admin/2fa");
  return { userId: session.user.id };
}

// Only for the /admin/2fa pages and their actions: a valid ADMIN session that has not
// entered its TOTP code yet. A session that already did goes on to /admin.
export async function requireAdminPendingTotp(): Promise<{
  userId: string;
  sessionId: string;
  totpConfirmed: boolean;
}> {
  const session = await currentSession();
  if (!session || session.user.role !== "ADMIN") redirect("/login");
  if (session.user.totpConfirmedAt && session.totpVerifiedAt) redirect("/admin");
  return {
    userId: session.user.id,
    sessionId: session.sessionId,
    totpConfirmed: session.user.totpConfirmedAt !== null,
  };
}

// Signs this browser out by ending the session of its cookie in the database. The cookie
// is left as it is: it no longer opens anything, and the next sign-in replaces it. (Changing
// a cookie inside a server action makes Next.js re-render the page, which would redirect
// away before the user sees why they were signed out.)
export async function endCurrentSession(): Promise<void> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (rawToken) await destroySession(rawToken);
}

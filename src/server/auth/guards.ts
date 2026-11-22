import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  destroySession,
  getSession,
  type SessionContext,
} from "@/server/auth/session";
import { safeReturnTo } from "@/server/auth/return-to";

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

// Adds `next` (only a path safeReturnTo accepts) so the sign-in comes back to that page.
function withNext(path: string, returnTo: string | undefined): string {
  const next = safeReturnTo(returnTo);
  if (next === null) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

// For every agent page and server action. The agencyId comes only from the session,
// never from the request. Anyone else (no session, expired, suspended, admin) goes to /login.
// `sessionId` lets the AI assistants tab tie a connect window to this browser's session.
// `returnTo` (plan 11): the page to come back to after sign-in and the email code; an admin
// is not sent back (no admin may connect an assistant).
export async function requireAgent(
  opts: { returnTo?: string } = {},
): Promise<{ userId: string; agencyId: string; sessionId: string }> {
  const session = await currentSession();
  if (!session) redirect(withNext(await signInPath(), opts.returnTo));
  if (session.user.role !== "AGENT" || !session.agency) redirect("/login");
  // Plan 8e: a new device must enter the email sign-in code first.
  if (!session.emailVerifiedAt) redirect(withNext("/login/verify", opts.returnTo));
  return { userId: session.user.id, agencyId: session.agency.id, sessionId: session.sessionId };
}

// Only for /login/verify and its actions: an agent session still waiting for its sign-in code.
export async function requireAgentPendingCode(): Promise<{ userId: string; sessionId: string; email: string }> {
  const session = await currentSession();
  if (!session || session.user.role !== "AGENT" || !session.agency) redirect("/login");
  if (session.emailVerifiedAt) redirect("/search");
  return { userId: session.user.id, sessionId: session.sessionId, email: session.user.email };
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

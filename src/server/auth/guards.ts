import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSession, type SessionContext } from "@/server/auth/session";

async function currentSession(): Promise<SessionContext | null> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;
  return getSession(rawToken);
}

// For every agent page and server action. The agencyId comes only from the session,
// never from the request. Anyone else (no session, expired, suspended, admin) goes to /login.
export async function requireAgent(): Promise<{ userId: string; agencyId: string }> {
  const session = await currentSession();
  if (!session || session.user.role !== "AGENT" || !session.agency) redirect("/login");
  return { userId: session.user.id, agencyId: session.agency.id };
}

// For every admin page and server action: a valid session of an ADMIN user.
// (The TOTP check for the session is added together with admin TOTP.)
export async function requireAdmin(): Promise<{ userId: string }> {
  const session = await currentSession();
  if (!session || session.user.role !== "ADMIN") redirect("/login");
  return { userId: session.user.id };
}

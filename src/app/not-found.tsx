import { cookies } from "next/headers";
import Link from "next/link";
import { StatePanel } from "@/components/StatePanel";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { SESSION_COOKIE, getSession } from "@/server/auth/session";

// Whether the browser asking is signed in as an admin: they get links into the admin area,
// everyone else the agent's. Only the role is read; nothing is shown about the session.
async function viewerIsAdmin(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return (await getSession(token))?.user.role === "ADMIN";
}

// 404 (screen 24). Someone not signed in who follows "Go to search" lands on the sign-in page.
export default async function NotFound() {
  const admin = await viewerIsAdmin();
  return (
    <StatePanel
      icon="?"
      tone="neutral"
      title="We couldn't find this page"
      actions={
        admin ? (
          <>
            <Link href="/admin" className={btnPrimary}>
              Go to the admin area
            </Link>
            <Link href="/admin/bookings" className={btnSecondary}>
              View all bookings
            </Link>
          </>
        ) : (
          <>
            <Link href="/search" className={btnPrimary}>
              Go to search
            </Link>
            <Link href="/bookings" className={btnSecondary}>
              My bookings
            </Link>
          </>
        )
      }
    >
      {admin ? "The link may be old or mistyped. Nothing was changed." : "The link may be old or mistyped. Your bookings and quotes are safe."}
    </StatePanel>
  );
}

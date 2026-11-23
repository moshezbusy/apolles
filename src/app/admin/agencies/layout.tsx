import { AdminHeader } from "@/components/AdminHeader";
import { countsForAdminHeader } from "@/server/admin/header";

// Shell of the admin console pages (everything under /admin/agencies). It only draws the
// header; it reads the session only to show the header's counters to a signed-in admin, never as
// the check: each page and server action calls requireAdmin() itself (ruling R35: a layout is
// not re-run on every navigation and must never be the check).
// The /admin/2fa pages are outside this layout on purpose: a half-signed-in admin gets only
// a Sign out button there, not the admin menu.
export default async function AdminAgenciesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="agencies" counts={await countsForAdminHeader()} />
      {children}
    </>
  );
}

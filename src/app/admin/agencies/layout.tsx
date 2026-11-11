import { AdminHeader } from "@/components/AdminHeader";

// Shell of the admin console pages (everything under /admin/agencies). It only draws the
// header and reads no session: each page and server action calls requireAdmin() itself
// (ruling R35: a layout is not re-run on every navigation and must never be the check).
// The /admin/2fa pages are outside this layout on purpose: a half-signed-in admin gets only
// a Sign out button there, not the admin menu.
export default function AdminAgenciesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="agencies" />
      {children}
    </>
  );
}

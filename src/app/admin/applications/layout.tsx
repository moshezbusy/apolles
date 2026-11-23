import { AdminHeader } from "@/components/AdminHeader";
import { countsForAdminHeader } from "@/server/admin/header";

// Shell of the applications pages. The session is read only for the header's counters, never as
// the check: each page and action calls requireAdmin().
export default async function AdminApplicationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="applications" counts={await countsForAdminHeader()} />
      {children}
    </>
  );
}

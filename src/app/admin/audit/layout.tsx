import { AdminHeader } from "@/components/AdminHeader";
import { countsForAdminHeader } from "@/server/admin/header";

// Shell of the admin action log pages: the header only. Each page calls requireAdmin() itself.
export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="audit" counts={await countsForAdminHeader()} />
      {children}
    </>
  );
}

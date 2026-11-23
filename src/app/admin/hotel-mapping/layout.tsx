import { AdminHeader } from "@/components/AdminHeader";
import { countsForAdminHeader } from "@/server/admin/header";

// Shell of the admin hotel mapping page: the header only. The page calls requireAdmin() itself.
export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="hotel-mapping" counts={await countsForAdminHeader()} />
      {children}
    </>
  );
}

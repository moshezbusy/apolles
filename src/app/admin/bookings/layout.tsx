import { AdminHeader } from "@/components/AdminHeader";
import { countsForAdminHeader } from "@/server/admin/header";

// Shell of the admin bookings pages: the header only. Each page calls requireAdmin() itself.
export default async function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="bookings" counts={await countsForAdminHeader()} />
      {children}
    </>
  );
}

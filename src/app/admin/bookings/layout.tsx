import { AdminHeader } from "@/components/AdminHeader";

// Shell of the admin bookings pages: the header only. Each page calls requireAdmin() itself.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="bookings" />
      {children}
    </>
  );
}

import { AdminHeader } from "@/components/AdminHeader";

// Shell of the admin demo access page: the header only. The page calls requireAdmin() itself.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="demo" />
      {children}
    </>
  );
}

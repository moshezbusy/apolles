import { AdminHeader } from "@/components/AdminHeader";

// Shell of the applications pages. Reads no session: each page and action calls requireAdmin().
export default function AdminApplicationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminHeader active="applications" />
      {children}
    </>
  );
}

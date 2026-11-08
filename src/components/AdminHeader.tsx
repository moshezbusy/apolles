import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

// Admin header: wordmark, the Agencies link and Sign out. Presentational only (no session
// data), so a layout may render it; the pages under it still check requireAdmin() themselves.
export function AdminHeader() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <span className="text-lg font-semibold tracking-tight text-gray-900">Apolles Admin</span>

        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          <Link href="/admin/agencies" className="font-medium text-gray-700 hover:text-gray-900">
            Agencies
          </Link>
        </nav>

        <div className="ml-auto text-sm">
          <SignOutButton className="rounded-md px-2 py-1.5 font-medium text-gray-700 hover:bg-gray-50" />
        </div>
      </div>
    </header>
  );
}

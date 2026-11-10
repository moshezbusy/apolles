import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

// Admin header (same frame as the agent header, mockup 07): wordmark, the Agencies tab and
// Sign out. Presentational only (no session data), so a layout may render it; the pages under
// it still check requireAdmin() themselves.
export function AdminHeader() {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line bg-white">
      <div className="mx-auto flex h-full w-[min(1260px,calc(100%-40px))] items-center gap-4 sm:gap-7">
        <span className="font-serif text-[22px] text-ink sm:text-[27px]">Apolles Admin</span>

        <nav aria-label="Main" className="flex h-full items-center gap-6 text-[13px]">
          <Link
            href="/admin/agencies"
            className="relative flex h-full items-center font-bold text-brand after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand"
          >
            Agencies
          </Link>
        </nav>

        <div className="ml-auto">
          <SignOutButton className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[#4d5a54] hover:bg-brand-soft hover:text-brand" />
        </div>
      </div>
    </header>
  );
}

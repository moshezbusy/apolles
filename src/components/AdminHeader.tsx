import Link from "next/link";
import { PhoneMenu, PhoneMenuSection, phoneMenuItem } from "@/components/PhoneMenu";
import { SignOutButton } from "@/components/SignOutButton";

// Admin header (same frame as the agent header, mockup 07): wordmark, the section tabs and
// Sign out. Presentational only (no session data), so a layout may render it; the pages under
// it still check requireAdmin() themselves. Below md the tabs do not fit: a "Menu" button opens
// them with Sign out (plan 9).
const TABS = [
  { key: "agencies", label: "Agencies", href: "/admin/agencies" },
  { key: "applications", label: "Applications", href: "/admin/applications" },
  { key: "bookings", label: "Bookings", href: "/admin/bookings" },
  { key: "supplier-log", label: "Supplier log", href: "/admin/supplier-log" },
] as const;

export function AdminHeader({ active = "agencies" }: { active?: (typeof TABS)[number]["key"] }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line bg-white">
      <div className="mx-auto flex h-full w-[min(1260px,calc(100%-40px))] items-center gap-4 sm:gap-7">
        <span className="whitespace-nowrap font-serif text-[22px] text-ink sm:text-[27px]">Apolles Admin</span>

        <nav aria-label="Main" className="hidden h-full items-center gap-6 text-[13px] md:flex">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={tab.key === active ? "page" : undefined}
              className={
                tab.key === active
                  ? "relative flex h-full items-center whitespace-nowrap font-bold text-brand after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-brand"
                  : "flex h-full items-center whitespace-nowrap font-semibold text-[#4d5a54] hover:text-brand"
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden md:block">
          <SignOutButton className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[#4d5a54] hover:bg-brand-soft hover:text-brand" />
        </div>

        <PhoneMenu className="ml-auto md:hidden">
          <PhoneMenuSection>
            {TABS.map((tab) => (
              <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? "page" : undefined} className={phoneMenuItem}>
                {tab.label}
              </Link>
            ))}
          </PhoneMenuSection>
          <PhoneMenuSection>
            <SignOutButton className={phoneMenuItem} />
          </PhoneMenuSection>
        </PhoneMenu>
      </div>
    </header>
  );
}

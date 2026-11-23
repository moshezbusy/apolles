import Link from "next/link";
import { PhoneMenu, PhoneMenuSection, phoneMenuItem } from "@/components/PhoneMenu";
import { SignOutButton } from "@/components/SignOutButton";

// Admin header (same frame as the agent header, mockup 07): wordmark, the section tabs and
// Sign out. Presentational only: the layout passes the counters (adminHeaderCounts, read only for
// a signed-in admin); the pages under it still check requireAdmin() themselves. Below md the tabs
// do not fit: a "Menu" button opens them with Sign out (plan 9).
// Counters: applications waiting for a review, bookings that need attention, open change requests.
export type AdminHeaderCounts = { applications: number; attention: number; changeRequests: number };

const TABS = [
  { key: "agencies", label: "Agencies", href: "/admin/agencies" },
  { key: "applications", label: "Applications", href: "/admin/applications", count: "applications", countLabel: "waiting" },
  { key: "bookings", label: "Bookings", href: "/admin/bookings", count: "attention", countLabel: "need attention" },
  { key: "change-requests", label: "Change requests", href: "/admin/change-requests?status=OPEN", count: "changeRequests", countLabel: "open" },
  { key: "supplier-log", label: "Supplier log", href: "/admin/supplier-log" },
  { key: "audit", label: "Action log", href: "/admin/audit" },
  { key: "security", label: "Security", href: "/admin/security" },
] as const satisfies readonly { key: string; label: string; href: string; count?: keyof AdminHeaderCounts; countLabel?: string }[];

type Tab = (typeof TABS)[number];

function Count({ tab, counts }: { tab: Tab; counts: AdminHeaderCounts | null | undefined }) {
  if (!counts || !("count" in tab)) return null;
  const n = counts[tab.count];
  if (n === 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-[#fbecea] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#9b3b2e]">
      {n}
      <span className="sr-only"> {tab.countLabel}</span>
    </span>
  );
}

export function AdminHeader({ active = "agencies", counts }: { active?: Tab["key"]; counts?: AdminHeaderCounts | null }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line bg-white">
      <div className="mx-auto flex h-full w-[min(1260px,calc(100%-40px))] items-center gap-4 sm:gap-7">
        <span className="whitespace-nowrap font-serif text-[22px] text-ink sm:text-[27px]">Apolles Admin</span>

        <nav aria-label="Main" className="hidden h-full items-center gap-5 text-[13px] md:flex">
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
              <Count tab={tab} counts={counts} />
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
                <Count tab={tab} counts={counts} />
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

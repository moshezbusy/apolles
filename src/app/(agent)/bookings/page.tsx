import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, emptyState, input, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { requireAgent } from "@/server/auth/guards";
import { BOOKING_TABS, STATUS_LABEL, listBookings, type BookingTab } from "@/server/booking/list";
import { shortDate } from "../search/parts";

export const metadata: Metadata = { title: "Bookings | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<BookingTab, string> = { all: "All", upcoming: "Upcoming", pending: "Pending", cancelled: "Cancelled" };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Screen 13: the agency's bookings, with status tabs, search, paging and a CSV export.
export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const q = await searchParams;
  const rawTab = one(q.tab);
  const tab: BookingTab = BOOKING_TABS.includes(rawTab as BookingTab) ? (rawTab as BookingTab) : "all";
  const search = one(q.q)?.slice(0, 100) ?? "";
  const cursor = one(q.cursor);
  const page = await listBookings(agencyId, { tab, ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) });
  const params = (extra: Record<string, string>) => new URLSearchParams({ tab, ...(search ? { q: search } : {}), ...extra }).toString();

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={pageTitle}>Bookings</h1>
        <a href={`/bookings/export?${params({})}`} className={btnSecondary}>
          Export CSV
        </a>
      </div>
      <nav aria-label="Booking status" className="mt-5 flex flex-wrap gap-2">
        {BOOKING_TABS.map((t) => (
          <Link
            key={t}
            href={`/bookings?${new URLSearchParams({ tab: t, ...(search ? { q: search } : {}) })}`}
            aria-current={t === tab ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${t === tab ? "bg-brand text-paper" : "bg-white text-[#4d5a54] hover:text-brand"}`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>
      <form method="get" action="/bookings" className="mt-4 flex max-w-xl gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input type="search" name="q" aria-label="Search bookings" defaultValue={search} maxLength={100} placeholder="Reference, guest or hotel" className={input} />
        <button type="submit" className={btnPrimary}>
          Search
        </button>
      </form>

      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>{search ? "No bookings match this search." : "No bookings here yet."}</p>
      ) : (
        <div className={`${tableWrap} mt-5`}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>Reference</th>
                <th className={th}>Hotel</th>
                <th className={th}>Lead guest</th>
                <th className={th}>Stay</th>
                <th className={th}>Total</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {page.rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${cell} font-mono`}>
                    <Link href={`/bookings/${r.id}`} className={link}>
                      {r.reference}
                    </Link>
                  </td>
                  <td className={td}>
                    {r.hotelName}
                    <span className="block text-xs text-muted">{r.hotelCity}</span>
                  </td>
                  <td className={td}>
                    {r.leadGivenName} {r.leadFamilyName}
                  </td>
                  <td className={td}>
                    {shortDate(r.checkin)} to {shortDate(r.checkout)}
                  </td>
                  <td className={`${td} tabular-nums`}>{formatUsd(r.totalMinor)}</td>
                  <td className={td}>{STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/bookings?${params({ cursor: page.nextCursor })}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

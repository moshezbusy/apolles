import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, emptyState, input, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { bookingSale } from "@/server/booking/selling";
import { lastFreeDay } from "@/server/quotes/pricing";
import type { CancelPenalty } from "@/server/supplier/types";
import { requireAgent } from "@/server/auth/guards";
import { BOOKING_TABS, STATUS_LABEL, listBookings, type BookingTab } from "@/server/booking/list";
import { shortDate } from "../search/parts";

export const metadata: Metadata = { title: "Bookings | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<BookingTab, string> = { all: "All", upcoming: "Upcoming", in_stay: "In stay", completed: "Completed", pending: "Pending", cancelled: "Cancelled" };

const DAY = 86_400_000;
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

// "2 nights · Check-in in 34 days" / "In stay" / "Checked out" (screen 13).
function stayLine(r: { checkin: string; checkout: string; status: string }, today: string): string {
  const nights = daysBetween(r.checkin, r.checkout);
  const n = `${nights} ${nights === 1 ? "night" : "nights"}`;
  if (r.status !== "CONFIRMED") return n;
  if (r.checkin > today) {
    const d = daysBetween(today, r.checkin);
    return `${n} · Check-in ${d === 1 ? "tomorrow" : `in ${d} days`}`;
  }
  return r.checkout > today ? `${n} · In stay` : `${n} · Checked out`;
}

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
  const today = new Date().toISOString().slice(0, 10);
  const page = await listBookings(agencyId, { tab, ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) });
  // Links keep the tab and the search. Built as plain strings (no object inside a template).
  const hrefFor = (path: string, values: { tab: string; cursor?: string | null }) => {
    const p = new URLSearchParams();
    p.set("tab", values.tab);
    if (search) p.set("q", search);
    if (values.cursor) p.set("cursor", values.cursor);
    return path + "?" + p.toString();
  };

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={pageTitle}>Bookings</h1>
        <a href={hrefFor("/bookings/export", { tab })} className={btnSecondary}>
          Export CSV
        </a>
      </div>
      <nav aria-label="Booking status" className="mt-5 flex flex-wrap gap-2">
        {BOOKING_TABS.map((t) => (
          <Link
            key={t}
            href={hrefFor("/bookings", { tab: t })}
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
                    <span className="block font-sans text-xs text-muted">Booked {shortDate(r.createdAt.toISOString().slice(0, 10))}</span>
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
                    <span className="block text-xs text-muted">{stayLine(r, today)}</span>
                    {(() => {
                      const free = r.status === "CONFIRMED" && r.checkin > today ? lastFreeDay({ refundable: r.refundable, cancelPenalties: r.cancelPenalties as unknown as CancelPenalty[] }) : null;
                      return free && free >= today ? <span className="block text-xs font-semibold text-[#2f7d4a]">Free cancel until {shortDate(free)}</span> : null;
                    })()}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {formatUsd(r.totalMinor)}
                    {(() => {
                      const sale = bookingSale(r);
                      return sale.priced && sale.saleMinor > 0 ? <span className="block text-xs text-muted">Paid · profit {formatUsd(sale.profitMinor)}</span> : null;
                    })()}
                  </td>
                  <td className={td}>{STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={hrefFor("/bookings", { tab, cursor: page.nextCursor })} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

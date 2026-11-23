import type { Metadata } from "next";
import Link from "next/link";
import { DateField } from "@/components/date-picker/DateField";
import { btnPrimary, btnSecondary, cell, emptyState, input, link, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { bookingSale } from "@/server/booking/selling";
import { freeCancelText } from "@/server/booking/free-cancel";
import { requireAgent } from "@/server/auth/guards";
import { BOOKING_TABS, listBookings, readBookingFilters, type BookingFilters, type BookingTab } from "@/server/booking/list";
import { shortDate } from "../search/parts";
import { BookingStatusPill } from "./status-pill";

export const metadata: Metadata = { title: "Bookings | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<BookingTab, string> = {
  all: "All",
  upcoming: "Upcoming",
  in_stay: "In stay",
  completed: "Completed",
  pending: "Pending",
  failed: "Not confirmed",
  cancelled: "Cancelled",
  not_finished: "Not finished",
};

const PAGE_SIZE = 20;
const MAX_SHOWN = 200;

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

// Screen 13: the agency's bookings, with status tabs, search, booked and check-in date filters,
// a count, "Load more" (the next rows are added below the ones already shown) and a CSV export.
export default async function BookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const q = await searchParams;
  const rawTab = one(q.tab);
  const tab: BookingTab = BOOKING_TABS.includes(rawTab as BookingTab) ? (rawTab as BookingTab) : "all";
  const search = one(q.q)?.slice(0, 100) ?? "";
  const filters: BookingFilters = readBookingFilters((key) => one(q[key]));
  const shownParam = Number(one(q.shown));
  const shown = Number.isInteger(shownParam) ? Math.min(Math.max(PAGE_SIZE, shownParam), MAX_SHOWN) : PAGE_SIZE;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const page = await listBookings(agencyId, { tab, ...(search ? { q: search } : {}), ...filters, take: shown });
  const filtered = Boolean(search || filters.bookedFrom || filters.bookedTo || filters.checkinFrom || filters.checkinTo || filters.unpriced);
  // Links keep the tab, the search and the filters. Built as plain strings (no object inside a template).
  const hrefFor = (path: string, values: { tab: string; shown?: number }) => {
    const p = new URLSearchParams();
    p.set("tab", values.tab);
    if (search) p.set("q", search);
    for (const key of ["bookedFrom", "bookedTo", "checkinFrom", "checkinTo"] as const) {
      const value = filters[key];
      if (value) p.set(key, value);
    }
    if (filters.unpriced) p.set("unpriced", "1");
    if (values.shown) p.set("shown", String(values.shown));
    return path + "?" + p.toString();
  };
  const drafts = tab === "not_finished";
  const noun = page.total === 1 ? "booking" : "bookings";

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={pageTitle}>Bookings</h1>
        <div className="flex flex-wrap gap-2">
          <a href={hrefFor("/bookings/export", { tab })} className={btnSecondary}>
            Export CSV
          </a>
          <Link href="/search" className={btnPrimary}>
            + New booking
          </Link>
        </div>
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
      <form method="get" action="/bookings" className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="tab" value={tab} />
        {filters.unpriced ? <input type="hidden" name="unpriced" value="1" /> : null}
        <div className="flex max-w-xl gap-2">
          <input type="search" name="q" aria-label="Search bookings" defaultValue={search} maxLength={100} placeholder="Reference, guest or hotel" className={input} />
          <button type="submit" className={btnPrimary}>
            Search
          </button>
        </div>
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="sr-only">Filter by date</legend>
          <DateField name="bookedFrom" label="Booked from" defaultValue={filters.bookedFrom ?? ""} />
          <DateField name="bookedTo" label="Booked to" defaultValue={filters.bookedTo ?? ""} />
          <DateField name="checkinFrom" label="Check-in from" defaultValue={filters.checkinFrom ?? ""} />
          <DateField name="checkinTo" label="Check-in to" defaultValue={filters.checkinTo ?? ""} />
          <button type="submit" className={btnSecondary}>
            Apply filters
          </button>
          {filtered ? (
            <Link href={`/bookings?tab=${tab}`} className={`${link} self-center`}>
              Clear filters
            </Link>
          ) : null}
        </fieldset>
      </form>
      {filters.unpriced ? <p className="mt-3 text-[13px] font-semibold text-[#37413d]">Showing bookings without a selling price.</p> : null}
      <p className="mt-4 text-[13px] text-muted">
        {page.total} {drafts ? `${noun} not finished` : noun}
      </p>
      {drafts && page.rows.length > 0 ? (
        <p className="mt-1 text-[13px] text-muted">Guest details were entered but the booking was not made. Open one to check the price again and book. Unfinished bookings are removed after 7 days.</p>
      ) : null}

      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-3`}>{filtered ? "No bookings match these filters." : drafts ? "No unfinished bookings." : "No bookings here yet."}</p>
      ) : (
        <div className={`${tableWrap} mt-3`}>
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
              {page.rows.map((r) => {
                const free = r.status === "CONFIRMED" && r.checkin > today ? freeCancelText(r, now) : null;
                const sale = bookingSale(r);
                const href = r.status === "DRAFT" ? `/book/${r.id}` : `/bookings/${r.id}`;
                return (
                  <tr key={r.id} className={tr}>
                    <td data-label="Reference" className={`${cell} font-mono`}>
                      <Link href={href} className={link}>
                        {r.reference}
                      </Link>
                      <span className="block font-sans text-xs text-muted">
                        {r.status === "DRAFT" ? "Started" : "Booked"} {shortDate(r.createdAt.toISOString().slice(0, 10))}
                      </span>
                    </td>
                    <td data-label="Hotel" className={td}>
                      {r.hotelName}
                      <span className="block text-xs text-muted">{r.hotelCity}</span>
                      {r.roomCount > 1 ? <span className="block text-xs font-semibold text-[#37413d]">{`${r.roomCount} rooms`}</span> : null}
                    </td>
                    <td data-label="Lead guest" className={td}>
                      {r.leadGivenName} {r.leadFamilyName}
                    </td>
                    <td data-label="Stay" className={td}>
                      {shortDate(r.checkin)} to {shortDate(r.checkout)}
                      <span className="block text-xs text-muted">{stayLine(r, today)}</span>
                      {free ? <span className="block text-xs font-semibold text-[#2f7d4a]">{free}</span> : null}
                    </td>
                    <td data-label="Total" className={`${td} tabular-nums`}>
                      {formatUsd(r.totalMinor)}
                      {sale.priced && sale.saleMinor > 0 ? <span className="block text-xs text-muted">Paid · profit {formatUsd(sale.profitMinor)}</span> : null}
                    </td>
                    <td data-label="Status" className={td}>
                      <BookingStatusPill status={r.status} />
                      {r.status === "DRAFT" ? (
                        <Link href={href} className={`${link} mt-1 block text-xs`}>
                          Finish booking
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor && shown < MAX_SHOWN ? (
        <p className="mt-4">
          <Link href={hrefFor("/bookings", { tab, shown: shown + PAGE_SIZE })} scroll={false} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : page.nextCursor ? (
        <p className="mt-4 text-[13px] text-muted">Showing the newest {MAX_SHOWN}. Narrow the list with the filters or the search box to see older bookings.</p>
      ) : null}
    </main>
  );
}

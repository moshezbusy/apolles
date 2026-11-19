import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, emptyState, input, link, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { listAllBookings } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";

export const metadata: Metadata = { title: "Bookings · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Admin: every agency's bookings, newest first. "Needs attention": bookings an admin must check
// with the supplier (the automatic check gave up, the supplier's rooms do not match ours, or only
// some rooms were cancelled).
export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const search = one(q.q)?.slice(0, 100) ?? "";
  const attention = one(q.attention) === "1";
  const cursor = one(q.cursor);
  const page = await listAllBookings({ ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}), needsAttention: attention });
  const more = new URLSearchParams({ ...(search ? { q: search } : {}), ...(attention ? { attention: "1" } : {}), ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Bookings</h1>
      <form method="get" action="/admin/bookings" className="mt-4 flex flex-wrap items-center gap-3">
        <input type="search" name="q" aria-label="Search bookings" defaultValue={search} maxLength={100} placeholder="Reference, agency, hotel, guest or supplier itinerary" className={`${input} max-w-md`} />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="attention" value="1" defaultChecked={attention} /> Needs attention only
        </label>
        <button type="submit" className={btnPrimary}>
          Search
        </button>
      </form>
      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No bookings.</p>
      ) : (
        <div className={`${tableWrap} mt-5`}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>Reference</th>
                <th className={th}>Agency</th>
                <th className={th}>Hotel</th>
                <th className={th}>Stay</th>
                <th className={th}>Total</th>
                <th className={th}>Status</th>
                <th className={th}>Supplier itinerary</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {page.rows.map((r) => (
                <tr key={r.id} className={tr}>
                  <td data-label="Reference" className={`${cell} font-mono`}>
                    <Link href={`/admin/bookings/${r.id}`} className={link}>
                      {r.reference}
                    </Link>
                  </td>
                  <td data-label="Agency" className={td}>{r.agency.name}</td>
                  <td data-label="Hotel" className={td}>{r.hotelName}</td>
                  <td data-label="Stay" className={td}>
                    {r.checkin} to {r.checkout}
                  </td>
                  <td data-label="Total" className={`${td} tabular-nums`}>{formatUsd(r.totalMinor)}</td>
                  <td data-label="Status" className={td}>
                    {STATUS_LABEL[r.status]}
                    {r.needsAttention ? <span className="ml-2 rounded-full bg-[#fbecea] px-2 py-0.5 text-[11px] font-bold text-[#9b3b2e]">Needs attention</span> : null}
                  </td>
                  <td data-label="Supplier itinerary" className={`${td} font-mono text-xs`}>{r.supplierItineraryId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/admin/bookings?${more}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

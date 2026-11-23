import type { Metadata } from "next";
import Link from "next/link";
import type { BookingStatus } from "@/generated/prisma/client";
import { btnPrimary, btnSecondary, cell, emptyState, input, label, link, pageTitle, sectionTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { agencyOptions, dayStart, listAllBookings } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";

export const metadata: Metadata = { title: "Bookings · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const STATUSES = ["PENDING_CONFIRMATION", "CONFIRMED", "CANCEL_PENDING", "CANCELLED", "CANCELLED_BY_SUPPLIER", "FAILED"] as const satisfies readonly BookingStatus[];

function isStatus(value: string | undefined): value is (typeof STATUSES)[number] {
  return STATUSES.some((status) => status === value);
}

type Row = Awaited<ReturnType<typeof listAllBookings>>["rows"][number];

function BookingsTable({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <div className={`${tableWrap} mt-3`}>
      <table className={table}>
        <caption className="sr-only">{caption}</caption>
        <thead className={thead}>
          <tr>
            <th className={th}>Reference</th>
            <th className={th}>Agency</th>
            <th className={th}>Hotel</th>
            <th className={th}>Stay</th>
            <th className={th}>Booked (UTC)</th>
            <th className={th}>Total</th>
            <th className={th}>Status</th>
            <th className={th}>Supplier itinerary</th>
          </tr>
        </thead>
        <tbody className={tbody}>
          {rows.map((r) => (
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
              <td data-label="Booked (UTC)" className={`${td} text-xs`}>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td data-label="Total" className={`${td} tabular-nums`}>{formatUsd(r.totalMinor)}</td>
              <td data-label="Status" className={td}>
                {STATUS_LABEL[r.status]}
                {r.needsAttention ? <span className="ml-2 rounded-full bg-[#fbecea] px-2 py-0.5 text-[11px] font-bold text-[#9b3b2e]">Needs attention</span> : null}
              </td>
              <td data-label="Supplier itinerary" className={`${td} font-mono text-xs`}>{r.supplierItineraryId ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Admin: every agency's bookings, newest first, with the ones that need attention on top.
// "Needs attention": bookings an admin must check with the supplier (the automatic check gave up,
// the supplier's rooms do not match ours, only some rooms were cancelled, the hotel cancelled).
// Filters: status (or needs attention only), agency, booking date range (UTC), and a search.
export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const search = one(q.q)?.slice(0, 100) ?? "";
  const statusParam = one(q.status);
  // ?attention=1 is the older link for "Needs attention only".
  const attention = statusParam === "attention" || one(q.attention) === "1";
  const status = isStatus(statusParam) ? statusParam : undefined;
  const agency = one(q.agency)?.slice(0, 64) ?? "";
  const from = dayStart(one(q.from)) ? one(q.from)! : "";
  const to = dayStart(one(q.to)) ? one(q.to)! : "";
  const cursor = one(q.cursor);
  const [page, agencies] = await Promise.all([
    listAllBookings({
      ...(search ? { q: search } : {}),
      ...(status ? { status } : {}),
      ...(agency ? { agencyId: agency } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(cursor ? { cursor } : {}),
      needsAttention: attention,
    }),
    agencyOptions(),
  ]);
  const filters = {
    ...(search ? { q: search } : {}),
    ...(attention ? { status: "attention" } : status ? { status } : {}),
    ...(agency ? { agency } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const more = new URLSearchParams({ ...filters, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
  const attentionAll = new URLSearchParams({ ...filters, status: "attention" });

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Bookings</h1>
      <form method="get" action="/admin/bookings" className="mt-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto_auto_auto]">
        <label className={label}>
          Search
          <input type="search" name="q" defaultValue={search} maxLength={100} placeholder="Reference, agency, hotel, guest or itinerary" className={input} />
        </label>
        <label className={label}>
          Status
          <select name="status" defaultValue={attention ? "attention" : (status ?? "")} className={input}>
            <option value="">All statuses</option>
            <option value="attention">Needs attention</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Agency
          <select name="agency" defaultValue={agency} className={input}>
            <option value="">All agencies</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Booked from
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className={label}>
          Booked to
          <input type="date" name="to" defaultValue={to} className={input} />
        </label>
        <button type="submit" className={btnPrimary}>
          Filter bookings
        </button>
      </form>
      {page.attention.length > 0 ? (
        <section aria-labelledby="attention-title" className="mt-6">
          <h2 id="attention-title" className={sectionTitle}>
            Needs attention ({page.attention.length}
            {page.attentionMore ? "+" : ""})
          </h2>
          <BookingsTable rows={page.attention} caption="Bookings that need attention" />
          {page.attentionMore ? (
            <p className="mt-2">
              <Link href={`/admin/bookings?${attentionAll}`} className={link}>
                Show every booking that needs attention
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
      {page.rows.length === 0 ? (
        page.attention.length === 0 ? <p className={`${emptyState} mt-5`}>No bookings match these filters.</p> : null
      ) : (
        <section aria-label="Bookings" className="mt-6">
          {page.attention.length > 0 ? <h2 className={sectionTitle}>Other bookings</h2> : null}
          <BookingsTable rows={page.rows} caption="Bookings" />
        </section>
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

import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, cellWide, emptyState, input, label, link, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { SUPPLIER_CALL_TYPES, SUPPLIER_LOG_DAYS, dayStart, isSupplierCallType, listSupplierLog } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Supplier log · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Admin: every call to the supplier (spec section 6), newest first, kept 90 days. Personal and
// payment data were masked when each call was written. Filters: booking reference, errors only,
// the kind of call and a day range (UTC).
export default async function SupplierLogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const ref = one(q.ref)?.slice(0, 28) ?? "";
  const errors = one(q.errors) === "1";
  const typeParam = one(q.type);
  const type = isSupplierCallType(typeParam) ? typeParam : undefined;
  const from = dayStart(one(q.from)) ? one(q.from)! : "";
  const to = dayStart(one(q.to)) ? one(q.to)! : "";
  const cursor = one(q.cursor);
  const page = await listSupplierLog({
    ...(ref ? { reference: ref } : {}),
    ...(errors ? { errorsOnly: true } : {}),
    ...(type ? { type } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const filters = { ...(ref ? { ref } : {}), ...(errors ? { errors: "1" } : {}), ...(type ? { type } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const more = new URLSearchParams({ ...filters, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Supplier log</h1>
      <p className="mt-1 text-sm text-muted">Every call to the supplier, kept {SUPPLIER_LOG_DAYS} days. Personal and payment data are masked.</p>
      <form method="get" action="/admin/supplier-log" className="mt-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto_auto]">
        <label className={label}>
          Booking reference
          <input type="search" name="ref" defaultValue={ref} maxLength={28} placeholder="APL-…" className={input} />
        </label>
        <label className={label}>
          Call type
          <select name="type" defaultValue={type ?? ""} className={input}>
            <option value="">All calls</option>
            {Object.entries(SUPPLIER_CALL_TYPES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          From
          <input type="date" name="from" defaultValue={from} className={input} />
        </label>
        <label className={label}>
          To
          <input type="date" name="to" defaultValue={to} className={input} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-[13px]">
          <input type="checkbox" name="errors" value="1" defaultChecked={errors} /> Errors only
        </label>
        <button type="submit" className={btnPrimary}>
          Filter calls
        </button>
      </form>
      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No calls match these filters.</p>
      ) : (
        <div className={`${tableWrap} mt-5`}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>When (UTC)</th>
                <th className={th}>Call</th>
                <th className={th}>Status</th>
                <th className={th}>Time</th>
                <th className={th}>Booking</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {page.rows.map((r) => (
                <tr key={r.id} className={tr}>
                  <td data-label="When (UTC)" className={`${cell} text-xs`}>{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td data-label="Call" className={`${cell} ${cellWide} max-w-[520px] truncate font-mono text-xs`}>
                    <Link href={`/admin/supplier-log/${r.id}`} className={link}>
                      {r.method} {r.path}
                    </Link>
                  </td>
                  <td data-label="Status" className={td}>{r.status ?? r.error ?? "—"}</td>
                  <td data-label="Time" className={`${td} tabular-nums`}>{r.durationMs} ms</td>
                  <td data-label="Booking" className={`${td} font-mono text-xs`}>{r.affiliateReferenceId ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/admin/supplier-log?${more}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

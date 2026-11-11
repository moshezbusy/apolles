import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, emptyState, input, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
import { SUPPLIER_LOG_DAYS, listSupplierLog } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Supplier log · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Admin: every call to the supplier (spec section 6), newest first, kept 90 days. Personal and
// payment data were masked when each call was written.
export default async function SupplierLogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const ref = one(q.ref)?.slice(0, 28) ?? "";
  const cursor = one(q.cursor);
  const page = await listSupplierLog({ ...(ref ? { reference: ref } : {}), ...(cursor ? { cursor } : {}) });
  const more = new URLSearchParams({ ...(ref ? { ref } : {}), ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });
  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Supplier log</h1>
      <p className="mt-1 text-sm text-muted">Every call to the supplier, kept {SUPPLIER_LOG_DAYS} days. Personal and payment data are masked.</p>
      <form method="get" action="/admin/supplier-log" className="mt-4 flex gap-2">
        <input type="search" name="ref" aria-label="Booking reference" defaultValue={ref} maxLength={28} placeholder="Booking reference (APL-…)" className={`${input} max-w-xs`} />
        <button type="submit" className={btnPrimary}>
          Filter
        </button>
      </form>
      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No calls.</p>
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
                <tr key={r.id}>
                  <td className={`${cell} text-xs`}>{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td className={`${cell} max-w-[520px] truncate font-mono text-xs`}>
                    <Link href={`/admin/supplier-log/${r.id}`} className={link}>
                      {r.method} {r.path}
                    </Link>
                  </td>
                  <td className={td}>{r.status ?? r.error ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{r.durationMs} ms</td>
                  <td className={`${td} font-mono text-xs`}>{r.affiliateReferenceId ?? ""}</td>
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

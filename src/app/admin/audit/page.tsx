import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, cell, cellTop, emptyState, input, label, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { auditActions, listAuditLog } from "@/server/audit";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Action log · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function json(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

// Admin action log (spec section 3 row 14): who did what, and when, newest first. Filter by
// action and by the person who did it (their email). Rows hold no secrets or tokens, and any
// field that looks secret is hidden on the way here (redactAuditValue).
export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const action = one(q.action)?.slice(0, 100) ?? "";
  const actor = one(q.actor)?.slice(0, 254) ?? "";
  const cursor = one(q.cursor);
  const [page, actions] = await Promise.all([
    listAuditLog({ ...(action ? { action } : {}), ...(actor ? { actorEmail: actor } : {}), ...(cursor ? { cursor } : {}) }),
    auditActions(),
  ]);
  const filters = { ...(action ? { action } : {}), ...(actor ? { actor } : {}) };
  const more = new URLSearchParams({ ...filters, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Action log</h1>
      <p className="mt-1 text-sm text-muted">Every recorded action, newest first. Times are UTC.</p>
      <form method="get" action="/admin/audit" className="mt-4 grid items-end gap-3 sm:grid-cols-[260px_minmax(0,320px)_auto]">
        <label className={label}>
          Action
          <select name="action" defaultValue={action} className={input}>
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Done by (email)
          <input type="search" name="actor" defaultValue={actor} maxLength={254} placeholder="name@example.com" className={input} />
        </label>
        <button type="submit" className={btnPrimary}>
          Filter actions
        </button>
      </form>
      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No actions match these filters.</p>
      ) : (
        <div className={`${tableWrap} mt-5`}>
          <table className={table}>
            <thead className={thead}>
              <tr>
                <th className={th}>When (UTC)</th>
                <th className={th}>Who</th>
                <th className={th}>Action</th>
                <th className={th}>On</th>
                <th className={th}>Details</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {page.rows.map((r) => (
                <tr key={r.id} className={tr}>
                  <td data-label="When (UTC)" className={`${cell} text-xs`}>{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td data-label="Who" className={td}>
                    {r.actor.email}
                    <span className="block text-xs text-muted">{r.actor.role === "ADMIN" ? "Admin" : "Agent"}</span>
                  </td>
                  <td data-label="Action" className={`${td} font-mono text-xs`}>{r.action}</td>
                  <td data-label="On" className={`${td} text-xs`}>
                    {r.targetType === "Booking" ? (
                      <Link href={`/admin/bookings/${encodeURIComponent(r.targetId)}`} className="font-semibold text-brand hover:underline">
                        Booking
                      </Link>
                    ) : (
                      r.targetType
                    )}
                    <span className="block font-mono text-muted">{r.targetId}</span>
                  </td>
                  <td data-label="Details" className={`${cellTop} max-w-[420px] break-all font-mono text-xs text-ink`}>
                    {r.before !== null ? <span className="block">before {json(r.before)}</span> : null}
                    {r.after !== null ? <span className="block">after {json(r.after)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/admin/audit?${more}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

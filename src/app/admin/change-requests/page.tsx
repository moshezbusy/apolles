import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, emptyState, input, label, link, pageTitle, pillDot, pillGreen, pillRed } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";
import { listChangeRequests } from "@/server/change-requests";
import { MarkDoneForm } from "./done-form";

export const metadata: Metadata = { title: "Change requests · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Admin: what agents asked to change on their bookings (spec 7a: saved and emailed to the admin,
// no change by itself). The admin handles each with the supplier and marks it done with a note.
export default async function ChangeRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const statusParam = one(q.status);
  const status = statusParam === "OPEN" || statusParam === "DONE" ? statusParam : undefined;
  const booking = one(q.booking)?.slice(0, 64) ?? "";
  const cursor = one(q.cursor);
  const page = await listChangeRequests({ ...(status ? { status } : {}), ...(booking ? { bookingId: booking } : {}), ...(cursor ? { cursor } : {}) });
  const filters = { ...(status ? { status } : {}), ...(booking ? { booking } : {}) };
  const more = new URLSearchParams({ ...filters, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <main className="mx-auto w-[min(1100px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Change requests</h1>
      <p className="mt-1 text-sm text-muted">Agents ask here for changes to their bookings. Make the change with the supplier, then mark it done.</p>
      <form method="get" action="/admin/change-requests" className="mt-4 flex flex-wrap items-end gap-3">
        {booking ? <input type="hidden" name="booking" value={booking} /> : null}
        <label className={label}>
          Status
          <select name="status" defaultValue={status ?? ""} className={`${input} min-w-[160px]`}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="DONE">Done</option>
          </select>
        </label>
        <button type="submit" className={btnPrimary}>
          Filter requests
        </button>
        {booking ? (
          <Link href="/admin/change-requests" className={link}>
            Show every booking
          </Link>
        ) : null}
      </form>
      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No change requests here.</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {page.rows.map((r) => (
            <li key={r.id} className={`${card} bg-white p-5`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <Link href={`/admin/bookings/${r.booking.id}`} className={`${link} font-mono`}>
                  {r.booking.reference}
                </Link>
                <span>{r.agency.name}</span>
                <span className="text-muted">{STATUS_LABEL[r.booking.status]}</span>
                <span className="text-muted">
                  {r.author.name} ({r.author.email}) · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
                <span className={`ml-auto ${r.status === "OPEN" ? pillRed : pillGreen}`}>
                  <span aria-hidden="true" className={pillDot} />
                  {r.status === "OPEN" ? "Open" : "Done"}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink">{r.text}</p>
              {r.status === "OPEN" ? (
                <div className="mt-4">
                  <MarkDoneForm requestId={r.id} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  Done by {r.doneBy?.email ?? "an admin"}
                  {r.doneAt ? ` at ${r.doneAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}
                  {r.adminNote ? `: ${r.adminNote}` : "."}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/admin/change-requests?${more}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

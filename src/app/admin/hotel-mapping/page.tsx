import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, emptyState, input, label, pageTitle, pillDot, pillGreen, pillRed, sectionTitle } from "@/components/ui";
import type { SupplierHotelMapStatus } from "@/generated/prisma/client";
import { listHotelMappings, unlinkedLayerHotels } from "@/server/admin/hotel-mapping";
import { requireAdmin } from "@/server/auth/guards";
import { suggestHotels } from "@/server/search/destinations";
import { DecideForm, ProposeForm, RemoveForm } from "./forms";

export const metadata: Metadata = { title: "Hotel mapping · Admin · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_LABEL: Record<SupplierHotelMapStatus, string> = { PROPOSED: "Proposed", APPROVED: "Approved", REJECTED: "Rejected" };
const STATUSES = Object.keys(STATUS_LABEL) as SupplierHotelMapStatus[];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function when(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Admin: which hotels are also searched with Hotelbeds (through the supplier layer). A hotel gets
// Hotelbeds rates only once its link is approved here (owner decision 2026-11-23).
export default async function HotelMappingPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const statusParam = one(q.status);
  const status = STATUSES.find((s) => s === statusParam);
  const text = (one(q.q) ?? "").slice(0, 60);
  const cursor = one(q.cursor);
  const [page, found, unlinked] = await Promise.all([listHotelMappings({ ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }), text.trim().length >= 3 ? suggestHotels(text, 10) : Promise.resolve([]), unlinkedLayerHotels()]);
  const more = new URLSearchParams({ ...(status ? { status } : {}), ...(page.nextCursor ? { cursor: page.nextCursor } : {}) });

  return (
    <main className="mx-auto w-[min(1100px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Hotel mapping</h1>
      <p className="mt-1 text-sm text-muted">
        A hotel is searched with Hotelbeds only after you approve its link to a supplier layer hotel id. Check the hotel at Hotelbeds before you approve a link.
      </p>

      <section className={`${card} mt-5 bg-white p-5`}>
        <h2 className={sectionTitle}>Add a link</h2>
        <form method="get" action="/admin/hotel-mapping" className="mt-3 flex flex-wrap items-end gap-3">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <label className={label}>
            Hotel name
            <input name="q" defaultValue={text} minLength={3} maxLength={60} className={`${input} min-w-[260px]`} />
          </label>
          <button type="submit" className={btnPrimary}>
            Search hotels
          </button>
        </form>
        {text.trim().length >= 3 ? (
          found.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No hotel matches this name. Check the spelling and search again.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {found.map((hotel) => (
                <li key={hotel.id} className="flex flex-col gap-2 border-t border-line pt-3">
                  <p className="text-sm text-ink">
                    <strong>{hotel.name}</strong> <span className="text-muted">· {hotel.place} · hotel id {hotel.id}</span>
                  </p>
                  <ProposeForm propertyId={hotel.id} layerHotelIds={unlinked} />
                </li>
              ))}
            </ul>
          )
        ) : null}
        <p className="mt-4 text-xs text-muted">
          {unlinked.length > 0 ? `Supplier layer hotel ids with no link yet: ${unlinked.join(", ")}.` : "Every hotel the supplier layer maps has a link."} Suggestions by name and location are not
          available yet: the supplier layer gives its hotels as ids only.
        </p>
      </section>

      <form method="get" action="/admin/hotel-mapping" className="mt-6 flex flex-wrap items-end gap-3">
        <label className={label}>
          Status
          <select name="status" defaultValue={status ?? ""} className={`${input} min-w-[160px]`}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={btnPrimary}>
          Filter links
        </button>
      </form>

      {page.rows.length === 0 ? (
        <p className={`${emptyState} mt-5`}>No links here.</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {page.rows.map((row) => (
            <li key={row.id} className={`${card} bg-white p-5`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <strong className="text-ink">{row.propertyName}</strong>
                <span className="text-muted">{row.propertyPlace}</span>
                <span className="font-mono">hotel id {row.propertyId}</span>
                <span className="font-mono">supplier layer id {row.layerHotelId}</span>
                <span className={`ml-auto ${row.status === "APPROVED" ? pillGreen : pillRed}`}>
                  <span aria-hidden="true" className={pillDot} />
                  {STATUS_LABEL[row.status]}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">
                Added by {row.createdBy} at {when(row.createdAt)}
                {row.approvedBy && row.approvedAt ? `. Approved by ${row.approvedBy} at ${when(row.approvedAt)}` : ""}
                {row.note ? `. Note: ${row.note}` : "."}
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-4">
                {row.status !== "APPROVED" ? <DecideForm mappingId={row.id} decision="approve" /> : null}
                {row.status !== "REJECTED" ? <DecideForm mappingId={row.id} decision="reject" /> : null}
                <RemoveForm mappingId={row.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={`/admin/hotel-mapping?${more}`} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

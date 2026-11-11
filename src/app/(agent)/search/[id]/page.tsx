import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, alertInfo, btnPrimary, btnSecondary, card, emptyState, input, label, link } from "@/components/ui";
import { formatMinor } from "@/lib/supplier-money";
import { requireAgent } from "@/server/auth/guards";
import { minorToUsdText, parseListOptions } from "@/server/search/list-options";
import { listResults, searchSummary, type ListOptions } from "@/server/search/search";
import { startSearchAction } from "../actions";
import { dateRange } from "../dates";
import { HotelPhoto, Stars, formValuesOf, shortDate, stayText } from "../parts";
import { SearchForm } from "../search-form";
import { loadMoreAction } from "./actions";

export const metadata: Metadata = { title: "Search results | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORTS: { value: ListOptions["sort"]; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "stars_desc", label: "Stars, high to low" },
];

// The filters as URL params, for links that keep them (paging, the hotel page's way back).
function filterParams(o: ListOptions): URLSearchParams {
  const p = new URLSearchParams();
  if (o.sort !== "recommended") p.set("sort", o.sort);
  if (o.name) p.set("name", o.name);
  if (o.roomName) p.set("room", o.roomName);
  if (o.minPriceMinor !== undefined) p.set("min", minorToUsdText(o.minPriceMinor));
  if (o.maxPriceMinor !== undefined) p.set("max", minorToUsdText(o.maxPriceMinor));
  for (const s of o.stars ?? []) p.append("stars", String(s));
  if (o.freeCancellation) p.set("free", "1");
  return p;
}

function priceField(minor: number | undefined): string {
  return minor === undefined ? "" : minorToUsdText(minor);
}

// Screen 08: the results of one search, read from its stored snapshot (filters, sorting and
// paging never call the supplier). No map in phase 1. Prices are the supplier's totals for
// the whole stay, never divided per night (BP5).
export default async function ResultsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const query = await searchParams;
  const now = new Date();
  const summary = await searchSummary(agencyId, id, now);
  if (!summary) notFound();
  const { minDate, maxDate } = dateRange(now);
  const options = parseListOptions(query);
  const result = await listResults(agencyId, id, options, now);
  if (!result) notFound();
  const kept = filterParams(options);
  const pageHref = (cursor: string | null) => {
    const p = new URLSearchParams(kept);
    if (cursor) p.set("cursor", cursor);
    const qs = p.toString();
    return `/search/${id}${qs ? `?${qs}` : ""}`;
  };
  const skip = Number(options.cursor ?? 0);
  const previous = skip > 0 ? String(Math.max(0, skip - 20)) : null;
  const backTo = kept.toString();

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-6">
      <section className={`${card} p-4`}>
        <SearchForm action={startSearchAction} values={formValuesOf(summary)} minDate={minDate} maxDate={maxDate} compact />
      </section>

      {summary.expired ? (
        <div role="alert" className={`${alertInfo} mt-5 flex flex-wrap items-center justify-between gap-3`}>
          <span>These results expired (prices are kept for 30 minutes). Search again for current prices.</span>
          <Link href="/search" className={btnSecondary}>
            Search again
          </Link>
        </div>
      ) : (
        <>
          {query.notice === "unavailable" ? (
            <p role="alert" className={`${alertError} mt-5`}>
              More hotels could not be loaded right now. Try again in a few minutes.
            </p>
          ) : null}
          <p className="mt-5 text-[15px] text-ink" aria-live="polite">
            <strong>
              {result.total} {result.total === 1 ? "property" : "properties"} found
            </strong>{" "}
            <span className="text-muted">
              for {summary.destinationLabel}, {shortDate(summary.checkin)} to {shortDate(summary.checkout)} · {stayText(summary)}
            </span>
          </p>

          <div className="mt-4 grid gap-5 lg:grid-cols-[250px_1fr]">
            <aside className={`${card} h-fit p-4`}>
              <h2 className="text-base font-bold text-ink">Filters</h2>
              <form method="get" action={`/search/${id}`} className="mt-3 flex flex-col gap-4">
                <label className={label}>
                  Sort by
                  <select name="sort" defaultValue={options.sort} className={input}>
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Hotel name
                  <input type="text" name="name" maxLength={100} defaultValue={options.name ?? ""} placeholder="Search hotel" className={input} />
                </label>
                <label className={label}>
                  Room name
                  <input type="text" name="room" maxLength={100} defaultValue={options.roomName ?? ""} placeholder="Search room" className={input} />
                </label>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-xs font-semibold text-[#37413d]">Total price (USD)</legend>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" inputMode="decimal" name="min" aria-label="Minimum price" placeholder="Min" defaultValue={priceField(options.minPriceMinor)} className={input} />
                    <input type="text" inputMode="decimal" name="max" aria-label="Maximum price" placeholder="Max" defaultValue={priceField(options.maxPriceMinor)} className={input} />
                  </div>
                </fieldset>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-xs font-semibold text-[#37413d]">Star rating</legend>
                  {[5, 4, 3, 2, 1].map((s) => (
                    <label key={s} className="flex items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" name="stars" value={s} defaultChecked={options.stars?.includes(s) ?? false} />
                      {s} {s === 1 ? "star" : "stars"}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" name="free" value="1" defaultChecked={options.freeCancellation ?? false} />
                  Free cancellation only
                </label>
                <button type="submit" className={btnPrimary}>
                  Apply filters
                </button>
                <Link href={`/search/${id}`} className={link}>
                  Clear filters
                </Link>
              </form>
            </aside>

            <section aria-label="Hotels" className="flex flex-col gap-4">
              {result.hotels.length === 0 ? (
                <p className={emptyState}>
                  {result.total === 0 && kept.toString() === "" ? "No hotels are available for these dates. Try other dates." : "No hotels match these filters."}
                </p>
              ) : (
                result.hotels.map((hotel) => {
                  const href = `/search/${id}/hotels/${encodeURIComponent(hotel.propertyId)}${backTo ? `?${backTo}` : ""}`;
                  return (
                    <article key={hotel.propertyId} className={`${card} grid gap-4 overflow-hidden bg-white p-3.5 sm:grid-cols-[200px_1fr_190px]`}>
                      <HotelPhoto url={hotel.heroImage?.url} alt={hotel.name} className="h-40 w-full rounded-[12px] sm:h-full" />
                      <div className="flex flex-col gap-1.5 py-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-serif text-[24px] leading-tight text-ink">
                            <Link href={href} className="hover:underline">
                              {hotel.name}
                            </Link>
                          </h3>
                          <Stars rating={hotel.starRating} />
                        </div>
                        <p className="text-[13px] text-muted">{hotel.city}</p>
                        {hotel.refundableAvailable ? (
                          <p>
                            <span className="inline-block rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand">Free cancellation available</span>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end justify-center gap-1 border-t border-line pt-3 text-right sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                        <span className="text-xs text-muted">from</span>
                        <strong className="text-[22px] font-extrabold tabular-nums text-ink">{formatMinor(hotel.minTotal.minor, hotel.minTotal.currency)}</strong>
                        <span className="text-xs text-muted">{stayText(summary)}</span>
                        <span className="text-xs text-muted">Total, taxes and fees included</span>
                        <Link href={href} className={`${btnPrimary} mt-2 w-full`}>
                          View rooms
                        </Link>
                      </div>
                    </article>
                  );
                })
              )}

              <nav aria-label="Result pages" className="flex flex-wrap items-center justify-between gap-3">
                {previous !== null ? (
                  <Link href={pageHref(previous === "0" ? null : previous)} className={btnSecondary}>
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                {result.nextCursor ? (
                  <Link href={pageHref(result.nextCursor)} className={btnSecondary}>
                    Next →
                  </Link>
                ) : result.hasMoreFromSupplier ? (
                  <form action={loadMoreAction}>
                    <input type="hidden" name="snapshotId" value={id} />
                    <button type="submit" className={btnSecondary}>
                      Load more hotels
                    </button>
                  </form>
                ) : null}
              </nav>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

import type { Metadata } from "next";
import { RateIncludes } from "@/components/RateIncludes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, alertInfo, btnPrimary, btnSecondary, card, emptyState, input, inputUnsized, label, link } from "@/components/ui";
import { formatMinor } from "@/lib/supplier-money";
import { requireAgent } from "@/server/auth/guards";
import { minorToUsdText, parseListOptions, priceProblem } from "@/server/search/list-options";
import { listResults, offerRef, searchSummary, type ListOptions } from "@/server/search/search";
import { searchAgainAction, startSearchAction } from "../actions";
import { searchDateRange } from "../dates";
import { HotelPhoto, Stars, formValuesOf, shortDate, stayText } from "../parts";
import { SearchForm } from "../search-form";
import { loadMoreAction } from "./actions";
import { FiltersPanel, SortSelect } from "./filters-panel";
import { keptParams, resultsHref } from "../kept-params";
import { quoteParam } from "../quote-param";
import { cancellationLabel } from "../../_components/rate-text";
import { SubmitButton } from "../../_components/submit-button";
import { addToQuoteAction } from "../../quotes/actions";
import { AddToQuote } from "../../quotes/add-to-quote";
import { QUOTES_ONE_ROOM, openQuotes, quoteCode } from "@/server/quotes/quotes";
import { multiRoomAllowed } from "@/server/supplier";
import type { HotelCard } from "@/server/search/search";

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

const PAGE_SIZE = 20;

// What went wrong on "Load more hotels" (?notice=) or on "Search again" (?again=), in plain words.
const LOAD_MORE_NOTICE: Record<string, string> = {
  unavailable: "More hotels could not be loaded right now. Try again in a few minutes.",
  limited: "Too many searches. Wait a minute and load more hotels again.",
  rejected: "More hotels could not be loaded for these dates and guests. Check the dates and guests and search again.",
};
const SEARCH_AGAIN_NOTICE: Record<string, string> = {
  input: "This search cannot be run again as it is. Check the destination, dates and guests above, then search.",
  limited: "Too many searches. Wait a minute and search again.",
  unavailable: "Hotel search is unavailable right now. Try again in a few minutes.",
};

// Only a known code gives a message; anything else in the URL gives none.
function noticeText(texts: Record<string, string>, value: string | string[] | undefined): string | null {
  const code = (Array.isArray(value) ? value[0] : value) ?? "";
  return Object.hasOwn(texts, code) ? (texts[code] ?? null) : null;
}

// "Load more hotels": the next 250 hotels of the destination. The form carries the page's own
// query (filters, sort, page, quote), so the agent comes back to the same view.
function LoadMore({ snapshotId, back }: { snapshotId: string; back: string }) {
  return (
    <form action={loadMoreAction}>
      <input type="hidden" name="snapshotId" value={snapshotId} />
      <input type="hidden" name="back" value={back} />
      <SubmitButton className={btnSecondary} pendingText="Loading more hotels…">
        Load more hotels
      </SubmitButton>
    </form>
  );
}

function priceField(minor: number | undefined): string {
  return minor === undefined ? "" : minorToUsdText(minor);
}

// The rate behind the card's price, as on the hotel page: "Book this room" opens guest details and
// "Add to quote" adds it; the server reads the room and the price from the search (plan 8d-3).
// A search of several rooms cannot go into a quote (plan 10): the card says so instead.
function CardRoom({ best, href, now }: { best: NonNullable<HotelCard["best"]>; href: string; now: Date }) {
  const cancel = cancellationLabel(best.offer, now);
  return (
    <>
      <p className="text-[13px] text-ink">
        <strong>Room:</strong> {best.offer.roomName}
      </p>
      <RateIncludes amenities={best.offer.amenities} />
      <p className={`text-[13px] font-semibold ${cancel.refundable ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{cancel.text}</p>
      {best.otherRates > 0 ? (
        <Link href={href} className={`${link} text-[13px]`}>
          View {best.otherRates} more room {best.otherRates === 1 ? "option" : "options"} →
        </Link>
      ) : null}
    </>
  );
}

function CardActions({
  best,
  snapshotId,
  quotes,
  quoteId,
  severalRooms,
}: {
  best: NonNullable<HotelCard["best"]>;
  snapshotId: string;
  quotes: { id: string; label: string }[];
  quoteId: string | null;
  severalRooms: boolean;
}) {
  const { offer } = best;
  const formId = `card-${offer.propertyId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <div className="mt-2 w-full">
      <form id={formId} method="get" action="/book/new">
        <input type="hidden" name="s" value={snapshotId} />
        <input type="hidden" name="p" value={offer.propertyId} />
        <input type="hidden" name="r" value={offerRef(offer)} />
        {offer.bedGroups.length === 1 ? (
          <input type="hidden" name="b" value={offer.bedGroups[0]!.id} />
        ) : (
          <select name="b" aria-label="Bed type" defaultValue={offer.bedGroups[0]?.id} className={`${inputUnsized} mb-1.5 w-full text-base sm:text-xs`}>
            {offer.bedGroups.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.description}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className={`${btnPrimary} w-full`}>
          Book this room
        </button>
      </form>
      {severalRooms ? <p className="mt-2 text-xs text-muted">{QUOTES_ONE_ROOM}</p> : <AddToQuote formId={formId} quotes={quotes} defaultQuoteId={quoteId} action={addToQuoteAction} />}
    </div>
  );
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
  const { minDate, maxDate } = searchDateRange(now);
  const options = parseListOptions(query);
  const priceMessage = priceProblem(query);
  const result = await listResults(agencyId, id, options, now);
  if (!result) notFound();
  const kept = filterParams(options);
  // Plan 5b: the quote this search adds to ("+ Add hotel" on a quote) stays on every link.
  const quoteId = quoteParam(query.quote);
  if (quoteId) kept.set("quote", quoteId);
  const pageHref = (cursor: string | null) => resultsHref(id, kept, cursor ? { cursor } : {});
  const skip = Number(options.cursor ?? 0);
  const previous = skip > 0 ? String(Math.max(0, skip - PAGE_SIZE)) : null;
  // The hotel link keeps the filters and this page of results, for "Back to hotels". "Load more
  // hotels" carries the same, so it comes back to this view.
  const back = new URLSearchParams(kept);
  if (options.cursor) back.set("cursor", options.cursor);
  const backTo = back.toString();
  const filtered = filterParams({ ...options, sort: "recommended" }).toString() !== "";
  // Only the first hotels of a large destination are asked for at once (250 at a time): the page
  // says so, and "Load more hotels" asks for the next ones.
  const partOf = result.hasMoreFromSupplier ? `the first ${result.loaded.toLocaleString("en-US")} of ${result.candidates.toLocaleString("en-US")} hotels in this destination` : null;
  const loadNotice = noticeText(LOAD_MORE_NOTICE, query.notice);
  const againNotice = noticeText(SEARCH_AGAIN_NOTICE, query.again);
  // Plan 5b: "Add to quote" lists the agency's open quotes; one opened from a quote is preselected.
  const severalRooms = summary.rooms.length > 1;
  const quotes = summary.expired || severalRooms ? [] : (await openQuotes(agencyId, quoteId)).map((q) => ({ id: q.id, label: `${quoteCode(q.number)} · ${q.title || "Untitled quote"}` }));

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-6">
      <section className={`${card} p-4`}>
        <SearchForm action={startSearchAction} values={formValuesOf(summary)} minDate={minDate} maxDate={maxDate} compact quoteId={quoteId} multiRoomAllowed={multiRoomAllowed()} />
      </section>

      {summary.expired ? (
        <>
          {againNotice ? (
            <p role="alert" className={`${alertError} mt-5`}>
              {againNotice}
            </p>
          ) : null}
          <div role="alert" className={`${alertInfo} mt-5 flex flex-wrap items-center justify-between gap-3`}>
            <span>These results expired (prices are kept for 30 minutes). Search again for current prices.</span>
            {/* One click runs the same search again (destination, dates and guests as stored). */}
            <form action={searchAgainAction}>
              <input type="hidden" name="snapshotId" value={id} />
              {quoteId ? <input type="hidden" name="quote" value={quoteId} /> : null}
              <SubmitButton className={btnSecondary} pendingText="Searching…">
                Search again
              </SubmitButton>
            </form>
          </div>
        </>
      ) : (
        <>
          {loadNotice ? (
            <p role="alert" className={`${alertError} mt-5`}>
              {loadNotice}
            </p>
          ) : null}
          <p className="mt-5 text-[15px] text-ink" aria-live="polite">
            <strong>
              {result.total} {result.total === 1 ? "property" : "properties"} found
            </strong>{" "}
            <span className="text-muted">
              for {summary.destinationLabel}, {shortDate(summary.checkin)} to {shortDate(summary.checkout)} · {stayText(summary)}
            </span>
            {partOf ? <span className="block text-[13px] text-muted">Showing {partOf}. Use &quot;Load more hotels&quot; under the list for the rest.</span> : null}
          </p>

          <div className="mt-4 grid gap-5 lg:grid-cols-[250px_1fr]">
            <div className="h-fit">
            <FiltersPanel activeCount={[options.name, options.roomName, options.minPriceMinor !== undefined, options.maxPriceMinor !== undefined, options.stars?.length, options.freeCancellation].filter(Boolean).length}>
            <aside className={`${card} h-fit p-4 max-lg:mt-2`}>
              <h2 className="text-base font-bold text-ink">Filters</h2>
              <form method="get" action={`/search/${id}`} className="mt-3 flex flex-col gap-4">
                {/* The quote this search adds to stays through "Apply filters" and a sort change. */}
                {quoteId ? <input type="hidden" name="quote" value={quoteId} /> : null}
                <label className={label}>
                  Sort by
                  <SortSelect defaultValue={options.sort} className={input}>
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </SortSelect>
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
                  {priceMessage ? (
                    <p role="alert" className="text-xs font-semibold text-[#9b3b2e]">
                      {priceMessage}
                    </p>
                  ) : null}
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
                <Link href={resultsHref(id, keptParams(quoteId ? { quote: quoteId } : {}))} className={link}>
                  Clear filters
                </Link>
              </form>
            </aside>
            </FiltersPanel>
            </div>

            <section aria-label="Hotels" className="flex flex-col gap-4">
              {result.hotels.length === 0 ? (
                partOf ? (
                  // Nothing here yet, but the rest of the destination was not asked for: say so
                  // and offer the next hotels right here (a hotel-name filter often lands here).
                  <div className={`${emptyState} flex flex-wrap items-center justify-between gap-3`}>
                    <span>
                      {filtered ? `No hotel matches these filters among ${partOf}.` : `None of ${partOf} has rooms for these dates.`} Load more hotels to look in the rest.
                    </span>
                    <LoadMore snapshotId={id} back={backTo} />
                  </div>
                ) : (
                  <p className={emptyState}>
                    {result.total === 0 && !filtered ? "No hotels are available for these dates. Try other dates." : "No hotels match these filters. Change or clear the filters."}
                  </p>
                )
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
                            <span className="inline-block rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand">
                              {hotel.best && !cancellationLabel(hotel.best.offer, now).refundable ? "Free cancellation on other rooms" : "Free cancellation available"}
                            </span>
                          </p>
                        ) : null}
                        {hotel.best ? <CardRoom best={hotel.best} href={href} now={now} /> : null}
                      </div>
                      <div className="flex flex-col items-end justify-center gap-1 border-t border-line pt-3 text-right sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                        <span className="text-xs text-muted">from</span>
                        <strong className="text-[22px] font-extrabold tabular-nums text-ink">{formatMinor(hotel.minTotal.minor, hotel.minTotal.currency)}</strong>
                        <span className="text-xs text-muted">{stayText(summary)}</span>
                        <span className="text-xs text-muted">
                          {hotel.feesAtProperty ? "Total, taxes included; more to pay at the property" : "Total, taxes and fees included"}
                        </span>
                        {hotel.best ? (
                          <CardActions best={hotel.best} snapshotId={id} quotes={quotes} quoteId={quoteId} severalRooms={severalRooms} />
                        ) : (
                          <Link href={href} className={`${btnPrimary} mt-2 w-full`}>
                            View rooms
                          </Link>
                        )}
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
                {result.hotels.length > 0 ? (
                  <span className="text-[13px] text-muted">
                    {skip + 1}-{skip + result.hotels.length} of {result.total}
                  </span>
                ) : null}
                <span className="flex flex-wrap items-center gap-3">
                  {result.hasMoreFromSupplier && result.hotels.length > 0 ? <LoadMore snapshotId={id} back={backTo} /> : null}
                  {result.nextCursor ? (
                    <Link href={pageHref(result.nextCursor)} className={btnSecondary}>
                      Next →
                    </Link>
                  ) : null}
                </span>
              </nav>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

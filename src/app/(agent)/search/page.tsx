import type { Metadata } from "next";
import Link from "next/link";
import { alertInfo, card, link, pageTitle } from "@/components/ui";
import { formatDmy } from "@/components/date-picker/calendar";
import { requireAgent } from "@/server/auth/guards";
import { destinationById } from "@/server/search/destinations";
import { getQuote, listQuotes, quoteCode } from "@/server/quotes/quotes";
import { recentSearches } from "@/server/search/recent";
import { multiRoomAllowed } from "@/server/supplier";
import { clearRecentAction, startSearchAction } from "./actions";
import { SearchForm } from "./search-form";
import { dateRange, defaultSearchValues } from "./dates";
import { guestsText } from "./parts";
import { quoteParam } from "./quote-param";

export const metadata: Metadata = { title: "Search | Apolles" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 100);
}

// Screen 07: hotel search. Opened from a quote ("+ Add hotel", plan 5b), it is filled with that
// destination, its dates and the quote's guests (one room: quotes are for one room), and the
// results offer "Add to quote" for it.
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId, userId } = await requireAgent();
  const now = new Date();
  const { minDate, maxDate } = dateRange(now);
  const params = await searchParams;
  const values = defaultSearchValues(now);

  const quoteId = quoteParam(params.quote);
  const quote = quoteId ? await getQuote(agencyId, quoteId) : null;
  const stay = quote?.stays.find((s) => s.id === one(params.stay));
  if (quote) {
    values.rooms = [{ adults: String(quote.adults), childAges: quote.childAges.map(String) }];
  }
  const [recent, selected] = await Promise.all([recentSearches({ agencyId, userId }), quote ? null : listQuotes(agencyId, { tab: "selected" })]);
  // "Search again" (?again=<id>): the agent's own recent search; dates already past fall back.
  const again = recent.find((r) => r.id === one(params.again));
  if (again && !quote) {
    values.destinationId = again.destinationId;
    values.destinationLabel = again.destinationName;
    values.rooms = again.rooms.map((r) => ({ adults: String(r.adults), childAges: r.childAges.map(String) }));
    if (again.checkin >= minDate) {
      values.checkin = again.checkin;
      values.checkout = again.checkout;
    }
  }
  if (stay) {
    const destination = await destinationById(stay.destinationId);
    if (destination) {
      values.destinationId = destination.id;
      values.destinationLabel = destination.label;
    }
    if (stay.checkin >= minDate) {
      values.checkin = stay.checkin;
      values.checkout = stay.checkout;
    }
  }

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-10">
      <h1 className={pageTitle}>Hotel search</h1>
      <p className="mt-1 text-sm text-muted">Search live hotel availability and rates.</p>
      {quote ? (
        <p className={`${alertInfo} mt-4`}>
          Adding hotels to {quoteCode(quote.number)} {quote.title ? `· ${quote.title}` : ""}. Choose a room, then &quot;Add to quote&quot;.
        </p>
      ) : null}
      <section className={`${card} mt-6 p-5`}>
        <SearchForm
          key={again?.id ?? "new"}
          action={startSearchAction}
          values={values}
          minDate={minDate}
          maxDate={maxDate}
          quoteId={quote?.id ?? null}
          multiRoomAllowed={multiRoomAllowed()}
        />
      </section>
      {!quote ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="recent-title" className={`${card} p-5`}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="recent-title" className="text-base font-bold text-ink">
                Recent searches
              </h2>
              {recent.length > 0 ? (
                <form action={clearRecentAction}>
                  <button type="submit" className="text-xs font-semibold text-muted hover:text-ink">
                    Clear all
                  </button>
                </form>
              ) : null}
            </div>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Your searches will show here.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-white p-3 text-[13px]">
                    <span>
                      <strong className="block text-ink">{r.destinationName}</strong>
                      <span className="text-muted">
                        {formatDmy(r.checkin)} to {formatDmy(r.checkout)} · {`${r.rooms.length > 1 ? `${r.rooms.length} rooms · ` : ""}${guestsText(r.adults, r.childAges.length, " · ")}`}
                      </span>
                    </span>
                    <Link href={`/search?again=${r.id}`} className={link}>
                      Search again
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="attention-title" className={`${card} p-5`}>
            <h2 id="attention-title" className="text-base font-bold text-ink">
              Needs attention
            </h2>
            {!selected || selected.quotes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing waiting for you.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {selected.quotes.slice(0, 5).map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#d3e3da] bg-brand-soft p-3 text-[13px]">
                    <span>
                      <strong className="block text-ink">Client selected an option</strong>
                      <span className="text-[#37413d]">
                        {quoteCode(q.number)} {q.title ? `· ${q.title}` : ""} {q.client ? `· ${q.client.firstName} ${q.client.lastName}` : ""}
                      </span>
                    </span>
                    <Link href={`/quotes/${q.id}#selections`} className={link}>
                      Open quote
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

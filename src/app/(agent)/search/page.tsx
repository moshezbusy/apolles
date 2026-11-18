import type { Metadata } from "next";
import { alertInfo, card, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { destinationById } from "@/server/search/destinations";
import { getQuote, quoteCode } from "@/server/quotes/quotes";
import { startSearchAction } from "./actions";
import { SearchForm } from "./search-form";
import { dateRange, defaultSearchValues } from "./dates";
import { quoteParam } from "./quote-param";

export const metadata: Metadata = { title: "Search | Apolles" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 100);
}

// Screen 07: hotel search. Opened from a quote ("+ Add hotel", plan 5b), it is filled with that
// destination, its dates and the quote's guests, and the results offer "Add to quote" for it.
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const now = new Date();
  const { minDate, maxDate } = dateRange(now);
  const params = await searchParams;
  const values = defaultSearchValues(now);

  const quoteId = quoteParam(params.quote);
  const quote = quoteId ? await getQuote(agencyId, quoteId) : null;
  const stay = quote?.stays.find((s) => s.id === one(params.stay));
  if (quote) {
    values.adults = String(quote.adults);
    values.childCount = String(quote.childAges.length);
    values.childAges = quote.childAges.map(String);
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
        <SearchForm action={startSearchAction} values={values} minDate={minDate} maxDate={maxDate} quoteId={quote?.id ?? null} />
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { btnPrimary, btnSecondary, card, emptyState, input, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { QUOTE_TABS, listQuotes, quoteCode, type QuoteListItem, type QuoteTab } from "@/server/quotes/quotes";
import { shortDate } from "../search/parts";
import { createQuoteAction } from "./actions";
import { QuotePill, guestsText } from "./parts";

export const metadata: Metadata = { title: "Quotes | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<QuoteTab, string> = { all: "All", draft: "Drafts", sent: "Sent", viewed: "Viewed", selected: "Selected", booked: "Booked" };

const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function ago(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

// Screen 14: the agency's quotes, the agent's newest edit first, with status tabs and search. A
// client's view or selection changes the status line, never the order.
export default async function QuotesPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const params = await searchParams;
  const rawTab = one(params.tab);
  const tab: QuoteTab = (QUOTE_TABS as readonly string[]).includes(rawTab) ? (rawTab as QuoteTab) : "all";
  const q = one(params.q).slice(0, 100);
  const cursor = one(params.cursor);
  const page = await listQuotes(agencyId, { tab, q, ...(cursor ? { cursor } : {}) });
  const now = new Date();
  const hrefFor = (values: { tab: QuoteTab; cursor?: string | null }) => {
    const p = new URLSearchParams();
    if (values.tab !== "all") p.set("tab", values.tab);
    if (q) p.set("q", q);
    if (values.cursor) p.set("cursor", values.cursor);
    const s = p.toString();
    return s ? `/quotes?${s}` : "/quotes";
  };

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={pageTitle}>Quotes</h1>
        <form action={createQuoteAction}>
          <button type="submit" className={btnPrimary}>
            + New quote
          </button>
        </form>
      </div>

      <div className={`${card} mt-5 flex flex-wrap items-center gap-3 bg-white p-2.5`}>
        <form method="get" action="/quotes" className="min-w-[240px] flex-1">
          {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
          <input type="search" name="q" aria-label="Search quotes" defaultValue={q} maxLength={100} placeholder="Search by quote name, number, client or destination" className={input} />
        </form>
        <nav aria-label="Quote status" className="flex flex-wrap gap-1 rounded-[10px] bg-[#f4f2ed] p-1">
          {QUOTE_TABS.map((t) => (
            <Link
              key={t}
              href={hrefFor({ tab: t })}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${t === tab ? "bg-white text-ink shadow-sm" : "text-[#5f6863] hover:text-brand"}`}
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </nav>
      </div>

      {page.quotes.length === 0 ? (
        <p className={`${emptyState} mt-5`}>{q || tab !== "all" ? "No quotes match." : "No quotes yet. Start with \"+ New quote\", or add a room from a search."}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {page.quotes.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} now={now} />
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <p className="mt-4">
          <Link href={hrefFor({ tab, cursor: page.nextCursor })} className={btnSecondary}>
            Load more
          </Link>
        </p>
      ) : null}
    </main>
  );
}

function QuoteCard({ quote, now }: { quote: QuoteListItem; now: Date }) {
  const head = "text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8a938e]";
  return (
    <li className="overflow-hidden rounded-[14px] border border-line bg-white">
      <div className="grid items-center gap-4 p-4 md:grid-cols-[1.6fr_1fr_1fr_0.9fr_auto_auto]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-2">
            <Link href={`/quotes/${quote.id}`} className="truncate text-[15px] font-bold text-ink hover:underline">
              {quote.title || "Untitled quote"}
            </Link>
            <span className="text-xs text-muted">{quoteCode(quote.number)}</span>
          </p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {quote.destinations.map((d) => (
              <span key={d} className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-xs font-semibold text-[#4d5a54]">
                {d.split(",")[0]}
              </span>
            ))}
          </p>
        </div>
        <div className="text-[13px]">
          <p className={head}>Client</p>
          {quote.client ? (
            <>
              <p className="font-semibold text-ink">
                {quote.client.firstName} {quote.client.lastName}
              </p>
              <p className="text-xs text-muted">{quote.client.email ?? ""}</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-ink">No client yet</p>
              <p className="text-xs text-muted">Add before sending</p>
            </>
          )}
        </div>
        <div className="text-[13px]">
          <p className={head}>Options</p>
          <p className="font-semibold text-ink">
            {quote.hotels} {quote.hotels === 1 ? "hotel" : "hotels"} · {quote.rooms} {quote.rooms === 1 ? "room" : "rooms"}
          </p>
          <p className="text-xs text-muted">
            {quote.stays} {quote.stays === 1 ? "stay period" : "stay periods"}
          </p>
        </div>
        <div className="text-[13px]">
          <p className={head}>Last updated</p>
          <p className="font-semibold text-ink">{dayMonth.format(quote.editedAt)}</p>
          <p className="text-xs text-muted">{ago(quote.editedAt, now)}</p>
        </div>
        <QuotePill status={quote.status} closed={quote.closed} expired={quote.expired} partlyBooked={quote.status !== "BOOKED" && quote.booking !== null} />
        {quote.closed ? (
          <Link href={`/quotes/${quote.id}`} className={btnSecondary}>
            Open
          </Link>
        ) : quote.expired ? (
          // "Extend offer" is on the quote itself, next to its prices.
          <Link href={`/quotes/${quote.id}`} className={btnSecondary}>
            Extend offer
          </Link>
        ) : quote.status === "SELECTED" ? (
          <Link href={`/quotes/${quote.id}#selections`} className={btnPrimary}>
            Book selected option
          </Link>
        ) : quote.status === "BOOKED" && quote.booking ? (
          <Link href={`/bookings/${quote.booking.id}`} className={btnSecondary}>
            View booking
          </Link>
        ) : (
          <Link href={`/quotes/${quote.id}`} className={btnSecondary}>
            Open
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-[#faf9f6] px-4 py-2.5 text-xs text-muted">
        {quote.firstCheckin && quote.lastCheckout ? (
          <span className="font-bold text-ink">
            {shortDate(quote.firstCheckin)} to {shortDate(quote.lastCheckout)}
          </span>
        ) : null}
        <span>{guestsText(quote.adults, quote.childAges)}</span>
        <span>{quote.sentAt ? `Sent ${dayMonth.format(quote.sentAt)}` : "Not sent yet"}</span>
        <span className="ml-auto">
          {quote.status === "BOOKED" && quote.booking
            ? `Booked ${quote.booking.confirmedAt ? dayMonth.format(quote.booking.confirmedAt) : ""} · ${quote.booking.hotelName} · ${quote.booking.reference}`
            : quote.closed ? "Closed" : quote.expired ? "Offer expired" : quote.selectedAt ? `Client sent selections ${ago(quote.selectedAt, now).toLowerCase()}` : quote.viewedAt ? `Viewed ${ago(quote.viewedAt, now).toLowerCase()}` : quote.sentAt ? "Waiting for client" : ""}
        </span>
      </div>
    </li>
  );
}

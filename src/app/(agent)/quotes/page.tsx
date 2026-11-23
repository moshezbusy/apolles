import type { Metadata } from "next";
import Link from "next/link";
import { alertSuccess, btnPrimary, btnSecondary, card, emptyState, input, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { getClient } from "@/server/clients";
import { MAX_QUOTE_PAGES, QUOTE_TABS, listQuotes, quoteCode, quoteTabCounts, type QuoteListItem, type QuoteTab } from "@/server/quotes/quotes";
import { shortDate } from "../search/parts";
import { ActionForm } from "./action-form";
import { archiveQuoteAction, createQuoteAction, deleteQuoteAction, duplicateQuoteAction, unarchiveQuoteAction } from "./actions";
import { NewsBadge, QuotePill, guestsText } from "./parts";
import { PendingButton } from "./pending-button";

export const metadata: Metadata = { title: "Quotes | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<QuoteTab, string> = { all: "All", draft: "Drafts", sent: "Sent", viewed: "Viewed", selected: "Selected", booked: "Booked", archived: "Archived" };

const NOTICE: Record<string, string> = {
  deleted: "Quote deleted.",
  archived: "Quote archived and closed. It is in the Archived tab.",
};

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

// Screen 14: the agency's quotes, the agent's newest edit first, with status tabs (and how many
// each holds), search (name, number, destination, hotel, client name, email or phone) and a
// client filter (?client=, from the client card). "Load more" adds the next page below. A
// client's view or selection changes the status line, never the order.
export default async function QuotesPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const params = await searchParams;
  const rawTab = one(params.tab);
  const tab: QuoteTab = (QUOTE_TABS as readonly string[]).includes(rawTab) ? (rawTab as QuoteTab) : "all";
  const q = one(params.q).slice(0, 100);
  const cursor = one(params.cursor).slice(0, 64);
  const clientId = one(params.client).slice(0, 64);
  const pages = Math.min(Math.max(Number.parseInt(one(params.n), 10) || 1, 1), MAX_QUOTE_PAGES);
  const notice = NOTICE[one(params.notice)] ?? null;
  const filter = { q, ...(clientId ? { clientId } : {}) };
  const [page, counts, client] = await Promise.all([
    listQuotes(agencyId, { tab, ...filter, pages, ...(cursor ? { cursor } : {}) }),
    quoteTabCounts(agencyId, filter),
    clientId ? getClient(agencyId, clientId) : null,
  ]);
  const now = new Date();
  const hrefFor = (values: { tab: QuoteTab; cursor?: string | null; pages?: number; client?: string | null }) => {
    const p = new URLSearchParams();
    if (values.tab !== "all") p.set("tab", values.tab);
    if (q) p.set("q", q);
    const c = values.client === undefined ? clientId : values.client;
    if (c) p.set("client", c);
    if (values.cursor) p.set("cursor", values.cursor);
    if (values.pages && values.pages > 1) p.set("n", String(values.pages));
    const s = p.toString();
    return s ? `/quotes?${s}` : "/quotes";
  };
  // "Load more": one more page in the same view; past the most pages at once, the next ones start
  // after the last quote shown.
  const more = page.nextCursor ? (pages < MAX_QUOTE_PAGES && !cursor ? hrefFor({ tab, pages: pages + 1 }) : hrefFor({ tab, cursor: page.nextCursor })) : null;

  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={pageTitle}>Quotes</h1>
        <form action={createQuoteAction}>
          <PendingButton className={btnPrimary} pendingText="Opening…">
            + New quote
          </PendingButton>
        </form>
      </div>

      {notice ? (
        <p role="status" className={`${alertSuccess} mt-4`}>
          {notice}
        </p>
      ) : null}

      <div className={`${card} mt-5 flex flex-wrap items-center gap-3 bg-white p-2.5`}>
        <form method="get" action="/quotes" className="min-w-[240px] flex-1">
          {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
          {clientId ? <input type="hidden" name="client" value={clientId} /> : null}
          <input type="search" name="q" aria-label="Search quotes" defaultValue={q} maxLength={100} placeholder="Search by quote name, number, destination, hotel or client" className={input} />
        </form>
        <nav aria-label="Quote status" className="flex flex-wrap gap-1 rounded-[10px] bg-[#f4f2ed] p-1">
          {QUOTE_TABS.map((t) => (
            <Link
              key={t}
              href={hrefFor({ tab: t })}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${t === tab ? "bg-white text-ink shadow-sm" : "text-[#5f6863] hover:text-brand"}`}
            >
              {TAB_LABEL[t]} <span className="text-[#8a938e]">{counts[t]}</span>
            </Link>
          ))}
        </nav>
      </div>

      {clientId ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink">
          <span className="rounded-full bg-brand-soft px-3 py-1 font-semibold text-brand">
            Client: {client ? `${client.firstName} ${client.lastName}` : "not found"}
          </span>
          <Link href={hrefFor({ tab, client: null })} className="font-semibold text-brand hover:underline">
            Show all clients
          </Link>
        </p>
      ) : null}

      {page.quotes.length === 0 ? (
        <p className={`${emptyState} mt-5`}>{q || tab !== "all" || clientId ? "No quotes match." : "No quotes yet. Start with \"+ New quote\", or add a room from a search."}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {page.quotes.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} now={now} />
          ))}
        </ul>
      )}
      {more ? (
        <p className="mt-4">
          <Link href={more} scroll={false} className={btnSecondary}>
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
            <NewsBadge news={quote.news} />
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
        <div className="flex items-center gap-2">
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
        <QuoteMenu quote={quote} />
        </div>
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
            : quote.archived ? "Archived" : quote.closed ? "Closed" : quote.expired ? "Offer expired" : quote.selectedAt ? `Client sent selections ${ago(quote.selectedAt, now).toLowerCase()}` : quote.viewedAt ? `Viewed ${ago(quote.viewedAt, now).toLowerCase()}` : quote.sentAt ? "Waiting for client" : ""}
        </span>
      </div>
    </li>
  );
}

// "⋮" on a quote (mockup 14): Duplicate; Delete for a draft that was never sent, Archive or
// Unarchive for the others. Delete and Archive ask first.
function QuoteMenu({ quote }: { quote: QuoteListItem }) {
  const item = "w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold hover:bg-[#f4f2ed] disabled:opacity-60";
  const name = quote.title || "Untitled quote";
  return (
    <details className="relative">
      <summary aria-label="More actions" className="grid h-[42px] w-10 cursor-pointer list-none place-items-center rounded-lg border border-[#d9e1dc] bg-white text-lg text-[#4d5a54] hover:border-[#bcd0c6] [&::-webkit-details-marker]:hidden">
        ⋮
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-[12px] border border-line bg-white p-1.5 shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
        <ActionForm action={duplicateQuoteAction} className="flex flex-col">
          <input type="hidden" name="quoteId" value={quote.id} />
          <PendingButton className={`${item} text-ink`} pendingText="Duplicating…">
            Duplicate quote
          </PendingButton>
        </ActionForm>
        {quote.status === "DRAFT" && !quote.sentAt ? (
          <ActionForm action={deleteQuoteAction} className="flex flex-col" confirmText={`Delete "${name}"? Its destinations, hotels and rooms are deleted too. This cannot be undone.`}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={`${item} text-[#9b3b2e]`} pendingText="Deleting…">
              Delete quote
            </PendingButton>
          </ActionForm>
        ) : quote.archived ? (
          <ActionForm action={unarchiveQuoteAction} className="flex flex-col">
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={`${item} text-ink`} pendingText="Moving…">
              Unarchive quote
            </PendingButton>
          </ActionForm>
        ) : (
          <ActionForm
            action={archiveQuoteAction}
            className="flex flex-col"
            confirmText={`Archive "${name}"? It leaves the list${quote.status === "BOOKED" || quote.closed ? "" : " and the client link shows that the proposal is closed"}. You find it in the Archived tab.`}
          >
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={`${item} text-ink`} pendingText="Archiving…">
              Archive quote
            </PendingButton>
          </ActionForm>
        )}
      </div>
    </details>
  );
}

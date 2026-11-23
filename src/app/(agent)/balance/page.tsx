import type { Metadata } from "next";
import Link from "next/link";
import { btnSecondary, card, cell, emptyState, link, pageTitle, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { requireAgent } from "@/server/auth/guards";
import { bookingIdsByReference } from "@/server/booking/list";
import { forAgency } from "@/server/scope";
import { getBalance } from "@/server/wallet/ledger";
import { TYPE_LABEL } from "./labels";
import { TopUpByBankTransfer } from "./top-up";

export const metadata: Metadata = { title: "Balance · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<{ shown?: string | string[] }>;

const PAGE_SIZE = 50; // one page of the ledger
const MAX_SHOWN = 500;

function formatWhen(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// "+USD 1,000.00" for money in, "-USD 50.00" for money out.
function signedUsd(cents: number): string {
  return cents > 0 ? `+${formatUsd(cents)}` : formatUsd(cents);
}

// Agent balance page: available and held amounts, how to top up by bank transfer, and the
// ledger history with the balance after each row, its booking (a link) and its reason. "Load
// more" shows the next 50 rows below the ones already shown. Everything is read for the agency of
// the signed-in agent only (agencyId from the session, never from the request).
export default async function BalancePage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { shown: rawShown } = await searchParams;
  const shownParam = Number(typeof rawShown === "string" ? rawShown : "");
  const shown = Number.isInteger(shownParam) ? Math.min(Math.max(PAGE_SIZE, shownParam), MAX_SHOWN) : PAGE_SIZE;
  const scope = forAgency(agencyId);

  // Page after page of the agency's own ledger until `shown` rows (at most 10 pages).
  const entries: Awaited<ReturnType<typeof scope.ledger.listWithBalance>>["entries"] = [];
  let nextCursor: string | null = null;
  do {
    const page = await scope.ledger.listWithBalance(nextCursor ?? undefined, PAGE_SIZE);
    entries.push(...page.entries);
    nextCursor = page.nextCursor;
  } while (nextCursor && entries.length < shown);
  const [balance, agency, bookingIds] = await Promise.all([
    getBalance(agencyId),
    scope.agency.profile(),
    bookingIdsByReference(agencyId, entries.map((e) => e.bookingRef ?? "")),
  ]);

  return (
    <main className="flex-1">
      <div className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
        <div>
          <h1 className={pageTitle}>Balance</h1>
          <p className="mt-1 text-[13px] text-muted">Your prepaid USD balance, top-ups and charges.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section id="available-balance" aria-labelledby="available-balance-label" className={`${card} p-6`}>
            <h2 id="available-balance-label" className="text-xs font-semibold text-muted">
              Available balance
            </h2>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-brand">{formatUsd(balance.balanceCents)}</p>
          </section>
          <section id="held-balance" aria-labelledby="held-balance-label" className={`${card} p-6`}>
            <h2 id="held-balance-label" className="text-xs font-semibold text-muted">
              Held for bookings
            </h2>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-ink">{formatUsd(balance.heldCents)}</p>
          </section>
        </div>

        <TopUpByBankTransfer reference={agency?.bankReference ?? null} />

        <section id="history" aria-labelledby="history-label">
          <h2 id="history-label" className="mb-3 text-lg font-bold text-ink">
            History
          </h2>
          {entries.length === 0 ? (
            <p className={emptyState}>No transactions yet.</p>
          ) : (
            <div className={tableWrap}>
              <table className={table}>
                <thead className={thead}>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} text-right`}>Balance after</th>
                  </tr>
                </thead>
                <tbody className={tbody}>
                  {entries.map((entry) => (
                    <tr key={entry.id} className={tr}>
                      <td data-label="Date" className={`${cell} whitespace-nowrap text-[13px] text-muted`}>{formatWhen(entry.createdAt)}</td>
                      <td data-label="Description" className={td}>
                        <span className="font-semibold">{TYPE_LABEL[entry.type]}</span>
                        {entry.bookingRef ? <BookingRef reference={entry.bookingRef} id={bookingIds.get(entry.bookingRef)} /> : null}
                        {entry.reason ? <span className="block text-xs text-muted">{entry.reason}</span> : null}
                      </td>
                      <td data-label="Amount"
                        className={`${cell} whitespace-nowrap text-right font-bold tabular-nums ${
                          entry.amountCents > 0 ? "text-brand" : "text-ink"
                        }`}
                      >
                        {signedUsd(entry.amountCents)}
                      </td>
                      <td data-label="Balance after" className={`${td} whitespace-nowrap text-right tabular-nums`}>
                        {formatUsd(entry.balanceAfterCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor && shown < MAX_SHOWN ? (
            <p className="mt-4">
              <Link href={`/balance?shown=${shown + PAGE_SIZE}#history`} scroll={false} className={btnSecondary}>
                Load more
              </Link>
            </p>
          ) : nextCursor ? (
            <p className="mt-4 text-[13px] text-muted">Showing the newest {MAX_SHOWN} rows. Contact Apolles support for older ones.</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

// The booking of a row ("Booking APL-..."), a link when it is one of the agency's own bookings.
function BookingRef({ reference, id }: { reference: string; id: string | undefined }) {
  return (
    <span className="block text-xs">
      Booking{" "}
      {id ? (
        <Link href={`/bookings/${id}`} className={`${link} font-mono text-xs`}>
          {reference}
        </Link>
      ) : (
        <span className="font-mono">{reference}</span>
      )}
    </span>
  );
}

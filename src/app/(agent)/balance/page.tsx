import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { card, emptyState, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { requireAgent } from "@/server/auth/guards";
import { getBankDetails } from "@/server/bank-details";
import { forAgency } from "@/server/scope";
import { getBalance } from "@/server/wallet/ledger";
import { TYPE_LABEL } from "./labels";

export const metadata: Metadata = { title: "Balance · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<{ cursor?: string | string[] }>;

const NOTE = "Top-ups are credited after Apolles confirms the transfer. USD only.";

function formatWhen(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// "+USD 1,000.00" for money in, "-USD 50.00" for money out.
function signedUsd(cents: number): string {
  return cents > 0 ? `+${formatUsd(cents)}` : formatUsd(cents);
}

// Agent balance page: available and held amounts, how to top up by bank transfer, and the
// ledger history with the balance after each row. Everything is read for the agency of the
// signed-in agent only (agencyId from the session, never from the request).
export default async function BalancePage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { cursor } = await searchParams;
  const scope = forAgency(agencyId);

  let history;
  try {
    history = await scope.ledger.listWithBalance(typeof cursor === "string" && cursor ? cursor : undefined);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor") redirect("/balance");
    throw error;
  }
  const [balance, agency] = await Promise.all([getBalance(agencyId), scope.agency.profile()]);
  const bankDetails = getBankDetails();

  return (
    <main className="flex-1">
      <div className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
        <div>
          <h1 className={pageTitle}>Balance</h1>
          <p className="mt-1 text-[13px] text-muted">Your prepaid USD balance, top-ups and charges.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section id="available-balance" aria-labelledby="available-balance-label" className={`${card} p-6`}>
            <h2 id="available-balance-label" className="text-xs font-semibold text-[#7d8581]">
              Available balance
            </h2>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-brand">{formatUsd(balance.balanceCents)}</p>
          </section>
          <section id="held-balance" aria-labelledby="held-balance-label" className={`${card} p-6`}>
            <h2 id="held-balance-label" className="text-xs font-semibold text-[#7d8581]">
              Held for bookings
            </h2>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-ink">{formatUsd(balance.heldCents)}</p>
          </section>
        </div>

        <section id="bank-transfer" aria-labelledby="bank-transfer-label" className={`${card} p-6`}>
          <h2 id="bank-transfer-label" className="mb-4 text-base font-bold text-ink">
            Top up by bank transfer
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
            {bankDetails.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-[#7d8581]">{detail.label}</dt>
                <dd className="font-mono text-ink">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {agency ? (
            <p className="mt-4 rounded-[9px] border border-[#d3e3da] bg-brand-soft px-3 py-2.5 text-sm font-semibold text-brand">
              Reference: <span className="font-mono">{agency.bankReference}</span>
            </p>
          ) : null}
          <p className="mt-3 text-[13px] text-muted">{NOTE}</p>
        </section>

        <section id="history" aria-labelledby="history-label">
          <h2 id="history-label" className="mb-3 text-lg font-bold text-ink">
            History
          </h2>
          {history.entries.length === 0 ? (
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
                  {history.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className={`${td} whitespace-nowrap text-[13px] text-muted`}>{formatWhen(entry.createdAt)}</td>
                      <td className={`${td} font-semibold`}>{TYPE_LABEL[entry.type]}</td>
                      <td
                        className={`${td} whitespace-nowrap text-right font-bold tabular-nums ${
                          entry.amountCents > 0 ? "text-brand" : ""
                        }`}
                      >
                        {signedUsd(entry.amountCents)}
                      </td>
                      <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                        {formatUsd(entry.balanceAfterCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {history.nextCursor ? (
            <Link
              href={`/balance?cursor=${encodeURIComponent(history.nextCursor)}`}
              className={`mt-4 inline-block ${link}`}
            >
              Load more
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}

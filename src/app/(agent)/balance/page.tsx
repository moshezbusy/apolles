import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
    <main className="flex-1 bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-semibold text-gray-900">Balance</h1>

        <div className="grid gap-4 sm:grid-cols-2">
          <section
            id="available-balance"
            aria-labelledby="available-balance-label"
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 id="available-balance-label" className="text-sm font-normal text-gray-600">
              Available balance
            </h2>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatUsd(balance.balanceCents)}</p>
          </section>
          <section
            id="held-balance"
            aria-labelledby="held-balance-label"
            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 id="held-balance-label" className="text-sm font-normal text-gray-600">
              Held for bookings
            </h2>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatUsd(balance.heldCents)}</p>
          </section>
        </div>

        <section
          id="bank-transfer"
          aria-labelledby="bank-transfer-label"
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 id="bank-transfer-label" className="mb-3 text-lg font-semibold text-gray-900">
            Top up by bank transfer
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            {bankDetails.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-gray-600">{detail.label}</dt>
                <dd className="font-mono text-gray-900">{detail.value}</dd>
              </div>
            ))}
          </dl>
          {agency ? (
            <p className="mt-3 text-sm font-medium text-gray-900">
              Reference: <span className="font-mono">{agency.bankReference}</span>
            </p>
          ) : null}
          <p className="mt-3 text-sm text-gray-600">{NOTE}</p>
        </section>

        <section id="history" aria-labelledby="history-label">
          <h2 id="history-label" className="mb-3 text-lg font-semibold text-gray-900">
            History
          </h2>
          {history.entries.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">No transactions yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Balance after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(entry.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-900">{TYPE_LABEL[entry.type]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{signedUsd(entry.amountCents)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
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
              className="mt-4 inline-block text-sm text-blue-700 hover:underline"
            >
              Load more
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}

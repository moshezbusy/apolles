import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LedgerEntryType } from "@/generated/prisma/enums";
import { formatUsd } from "@/lib/money";
import { getAgencyWallet } from "@/server/admin/money";
import { requireAdmin } from "@/server/auth/guards";
import { confirmTopupAction, recordAdjustmentAction, recordPayoutAction } from "./actions";
import { AdjustmentForm, PayoutForm, TopupForm } from "./wallet-forms";

export const metadata: Metadata = { title: "Wallet · Apolles", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
};

const TYPE_LABEL: Record<LedgerEntryType, string> = {
  TOPUP_BANK: "Bank top-up",
  HOLD: "Hold",
  HOLD_RELEASE: "Hold released",
  CHARGE: "Charge",
  REFUND: "Refund",
  PAYOUT: "Payout",
  ADJUSTMENT: "Adjustment",
};

function formatWhen(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function AgencyWalletPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { cursor } = await searchParams;
  const walletPath = `/admin/agencies/${encodeURIComponent(id)}/wallet`;

  let wallet;
  try {
    wallet = await getAgencyWallet(id, typeof cursor === "string" && cursor ? cursor : undefined);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor") redirect(walletPath);
    throw error;
  }
  if (!wallet) notFound();
  const { agency, balance } = wallet;

  // A fresh key for each render of the payout / adjustment forms: posting the same form twice
  // (double click, retry) records the entry once. After each post the page renders again with
  // new keys.
  const payoutKey = randomUUID();
  const adjustmentKey = randomUUID();

  return (
    <main className="flex-1 bg-gray-50 px-4 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <Link href="/admin/agencies" className="text-sm text-blue-700 hover:underline">
            ← Agencies
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">{agency.name}</h1>
          <p className="text-sm text-gray-600">
            Bank reference <span className="font-mono">{agency.bankReference}</span>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">Available balance</p>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatUsd(balance.balanceCents)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">Held for bookings</p>
            <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatUsd(balance.heldCents)}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <TopupForm agencyId={agency.id} agencyName={agency.name} action={confirmTopupAction} />
          <PayoutForm
            agencyId={agency.id}
            agencyName={agency.name}
            idempotencyKey={payoutKey}
            action={recordPayoutAction}
          />
          <AdjustmentForm
            agencyId={agency.id}
            agencyName={agency.name}
            idempotencyKey={adjustmentKey}
            action={recordAdjustmentAction}
          />
        </div>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Ledger history</h2>
          {wallet.entries.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">No entries yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {wallet.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatWhen(entry.createdAt)}</td>
                      <td className="px-4 py-3">{TYPE_LABEL[entry.type]}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatUsd(entry.amountCents)}</td>
                      <td className="px-4 py-3 text-gray-900">{entry.reason}</td>
                      <td className="px-4 py-3 font-mono text-gray-600">{entry.bookingRef ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {wallet.nextCursor ? (
            <Link
              href={`${walletPath}?cursor=${encodeURIComponent(wallet.nextCursor)}`}
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

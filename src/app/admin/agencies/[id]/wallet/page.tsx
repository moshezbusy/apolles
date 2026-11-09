import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LedgerEntryType } from "@/generated/prisma/enums";
import { card, cell, emptyState, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
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
    <main className="flex-1">
      <div className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 pb-16 pt-8">
        <div>
          <Link href="/admin/agencies" className={link}>
            ← Agencies
          </Link>
          <h1 className={`mt-3 ${pageTitle}`}>{agency.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            Bank reference <span className="font-mono font-semibold text-ink">{agency.bankReference}</span>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className={`${card} p-6`}>
            <p className="text-xs font-semibold text-[#7d8581]">Available balance</p>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-brand">{formatUsd(balance.balanceCents)}</p>
          </div>
          <div className={`${card} p-6`}>
            <p className="text-xs font-semibold text-[#7d8581]">Held for bookings</p>
            <p className="mt-1 text-[28px] font-bold tabular-nums text-ink">{formatUsd(balance.heldCents)}</p>
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
          <h2 className="mb-3 text-lg font-bold text-ink">Ledger history</h2>
          {wallet.entries.length === 0 ? (
            <p className={emptyState}>No entries yet.</p>
          ) : (
            <div className={tableWrap}>
              <table className={table}>
                <thead className={thead}>
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Type</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={th}>Reason</th>
                    <th className={th}>Booking</th>
                  </tr>
                </thead>
                <tbody className={tbody}>
                  {wallet.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className={`${cell} whitespace-nowrap text-[13px] text-muted`}>{formatWhen(entry.createdAt)}</td>
                      <td className={`${td} font-semibold`}>{TYPE_LABEL[entry.type]}</td>
                      <td className={`${td} whitespace-nowrap text-right font-bold tabular-nums`}>
                        {formatUsd(entry.amountCents)}
                      </td>
                      <td className={td}>{entry.reason}</td>
                      <td className={`${cell} font-mono text-[13px] text-muted`}>{entry.bookingRef ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {wallet.nextCursor ? (
            <Link
              href={`${walletPath}?cursor=${encodeURIComponent(wallet.nextCursor)}`}
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

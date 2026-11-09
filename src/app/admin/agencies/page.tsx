import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  btnPrimary,
  emptyState,
  link,
  pageTitle,
  pillDot,
  pillGreen,
  pillRed,
  table,
  tableWrap,
  tbody,
  td,
  th,
  thead,
} from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { listAgencies } from "@/server/admin/agencies";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Agencies · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<{ cursor?: string | string[] }>;

export default async function AgenciesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { cursor } = await searchParams;

  let page;
  try {
    page = await listAgencies(typeof cursor === "string" && cursor ? cursor : undefined);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid cursor") redirect("/admin/agencies");
    throw error;
  }

  return (
    <main className="flex-1">
      <div className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className={pageTitle}>Agencies</h1>
            <p className="mt-1 text-[13px] text-muted">Open, suspend and fund travel agencies.</p>
          </div>
          <Link href="/admin/agencies/new" className={btnPrimary}>
            New agency
          </Link>
        </div>

        {page.agencies.length === 0 ? (
          <p className={emptyState}>No agencies yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead className={thead}>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Country</th>
                  <th className={th}>Bank reference</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Balance</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className={tbody}>
                {page.agencies.map((agency) => {
                  const next = agency.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
                  return (
                    <tr key={agency.id}>
                      <td className={td}>
                        <span className="font-bold">{agency.name}</span>
                        {agency.agentEmail ? (
                          <span className="block text-xs text-muted">{agency.agentEmail}</span>
                        ) : null}
                      </td>
                      <td className={td}>{agency.country}</td>
                      <td className={`${td} font-mono text-[13px]`}>{agency.bankReference}</td>
                      <td className={td}>
                        <span className={agency.status === "ACTIVE" ? pillGreen : pillRed}>
                          <span aria-hidden="true" className={pillDot} />
                          {agency.status === "ACTIVE" ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className={`${td} text-right font-bold tabular-nums`}>{formatUsd(agency.balanceCents)}</td>
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <Link href={`/admin/agencies/${agency.id}/wallet`} className={`mr-4 ${link}`}>
                          Wallet
                        </Link>
                        <Link
                          href={`/admin/agencies/${agency.id}/confirm?status=${next}`}
                          className={agency.status === "ACTIVE" ? "text-sm font-semibold text-[#9b3b2e] hover:underline" : link}
                        >
                          {agency.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {page.nextCursor ? (
          <Link
            href={`/admin/agencies?cursor=${encodeURIComponent(page.nextCursor)}`}
            className={`mt-4 inline-block ${link}`}
          >
            Load more
          </Link>
        ) : null}
      </div>
    </main>
  );
}

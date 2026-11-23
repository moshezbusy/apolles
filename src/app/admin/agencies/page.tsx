import type { Metadata } from "next";
import type { AccountStatus } from "@/generated/prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { btnPrimary, cellWide, emptyState, input, label, link, pageTitle, pillDot, pillGreen, pillRed, table, tableWrap, tbody, td, th, thead, tr } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { listAgencies } from "@/server/admin/agencies";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Agencies · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<{ cursor?: string | string[]; q?: string | string[]; status?: string | string[] }>;

// Search by the agency's name or email (or its agent's), and filter by status.
export default async function AgenciesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { cursor, q: rawQ, status: rawStatus } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ.slice(0, 100) : "";
  const status: AccountStatus | undefined = rawStatus === "ACTIVE" || rawStatus === "SUSPENDED" ? rawStatus : undefined;
  const filters: { q?: string; status?: AccountStatus } = { ...(q ? { q } : {}), ...(status ? { status } : {}) };

  let page;
  try {
    page = await listAgencies(typeof cursor === "string" && cursor ? cursor : undefined, undefined, filters);
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

        <form method="get" action="/admin/agencies" className="mb-5 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
          <label className={label}>
            Search
            <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Agency name or email" className={input} />
          </label>
          <label className={label}>
            Status
            <select name="status" defaultValue={status ?? ""} className={input}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </label>
          <button type="submit" className={btnPrimary}>
            Search agencies
          </button>
        </form>

        {page.agencies.length === 0 ? (
          <p className={emptyState}>{q || status ? "No agencies match this search." : "No agencies yet."}</p>
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
                    <tr key={agency.id} className={tr}>
                      <td data-label="Name" className={td}>
                        <span className="font-bold">{agency.name}</span>
                        {agency.agentEmail ? (
                          <span className="block text-xs text-muted">{agency.agentEmail}</span>
                        ) : null}
                        {agency.agentInvited ? (
                          <span className="block text-xs font-semibold text-[#6f5a20]">Invited, not signed in yet</span>
                        ) : null}
                      </td>
                      <td data-label="Country" className={td}>{agency.country}</td>
                      <td data-label="Bank reference" className={`${td} font-mono text-[13px]`}>{agency.bankReference}</td>
                      <td data-label="Status" className={td}>
                        <span className={agency.status === "ACTIVE" ? pillGreen : pillRed}>
                          <span aria-hidden="true" className={pillDot} />
                          {agency.status === "ACTIVE" ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td data-label="Balance" className={`${td} text-right font-bold tabular-nums`}>{formatUsd(agency.balanceCents)}</td>
                      <td data-label="" className={`${td} ${cellWide} whitespace-nowrap text-right`}>
                        <Link href={`/admin/agencies/${agency.id}/wallet`} className={`mr-4 ${link}`}>
                          Wallet
                        </Link>
                        <Link href={`/admin/bookings?agency=${encodeURIComponent(agency.id)}`} className={`mr-4 ${link}`}>
                          Bookings
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
            href={`/admin/agencies?${new URLSearchParams({ ...filters, cursor: page.nextCursor })}`}
            className={`mt-4 inline-block ${link}`}
          >
            Load more
          </Link>
        ) : null}
      </div>
    </main>
  );
}

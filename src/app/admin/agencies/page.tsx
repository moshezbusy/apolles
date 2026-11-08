import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
    <main className="flex-1 bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Agencies</h1>
          <Link
            href="/admin/agencies/new"
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            New agency
          </Link>
        </div>

        {page.agencies.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
            No agencies yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Country</th>
                  <th className="px-4 py-3 font-medium">Bank reference</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {page.agencies.map((agency) => {
                  const next = agency.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
                  return (
                    <tr key={agency.id}>
                      <td className="px-4 py-3 text-gray-900">
                        {agency.name}
                        {agency.agentEmail ? (
                          <span className="block text-xs text-gray-500">{agency.agentEmail}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{agency.country}</td>
                      <td className="px-4 py-3 font-mono">{agency.bankReference}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            agency.status === "ACTIVE"
                              ? "rounded bg-green-100 px-2 py-0.5 text-green-800"
                              : "rounded bg-red-100 px-2 py-0.5 text-red-800"
                          }
                        >
                          {agency.status === "ACTIVE" ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatUsd(agency.balanceCents)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link
                          href={`/admin/agencies/${agency.id}/wallet`}
                          className="mr-4 text-blue-700 hover:underline"
                        >
                          Wallet
                        </Link>
                        <Link
                          href={`/admin/agencies/${agency.id}/confirm?status=${next}`}
                          className="text-blue-700 hover:underline"
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
            className="mt-4 inline-block text-sm text-blue-700 hover:underline"
          >
            Load more
          </Link>
        ) : null}
      </div>
    </main>
  );
}

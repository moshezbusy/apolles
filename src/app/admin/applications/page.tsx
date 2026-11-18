import type { Metadata } from "next";
import Link from "next/link";
import { btnSecondary, emptyState, link, pageTitle, table, tableWrap, tbody, td, th, thead } from "@/components/ui";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { listApplications } from "@/server/applications";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Applications · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<{ status?: string | string[]; cursor?: string | string[] }>;

const TABS: { id: ApplicationStatus; label: string }[] = [
  { id: "PENDING", label: "Pending" },
  { id: "APPROVED", label: "Approved" },
  { id: "REJECTED", label: "Rejected" },
];
const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

// Agency applications from "Join Apolles" (screen 02), newest first, 50 a page.
export default async function ApplicationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const q = await searchParams;
  const raw = Array.isArray(q.status) ? q.status[0] : q.status;
  const status = TABS.find((t) => t.id === raw)?.id ?? "PENDING";
  const cursor = typeof q.cursor === "string" ? q.cursor : undefined;
  const page = await listApplications({ status, ...(cursor ? { cursor } : {}) });

  return (
    <main className="flex-1">
      <div className="mx-auto w-[min(1260px,calc(100%-40px))] pb-16 pt-8">
        <h1 className={pageTitle}>Applications</h1>
        <p className="mt-1 text-[13px] text-muted">Travel businesses that asked to join. Approve to open the agency.</p>
        <nav aria-label="Status" className="mt-5 flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/admin/applications?status=${t.id}`}
              aria-current={t.id === status ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold ${t.id === status ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {page.rows.length === 0 ? (
          <p className={`${emptyState} mt-5`}>No applications here.</p>
        ) : (
          <div className={`${tableWrap} mt-5`}>
            <table className={table}>
              <thead className={thead}>
                <tr>
                  <th className={th}>Agency</th>
                  <th className={th}>Contact</th>
                  <th className={th}>Country</th>
                  <th className={th}>Applied</th>
                </tr>
              </thead>
              <tbody className={tbody}>
                {page.rows.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>
                      <Link href={`/admin/applications/${a.id}`} className={link}>
                        {a.agencyName}
                      </Link>
                    </td>
                    <td className={td}>
                      {a.contactName}
                      <span className="block text-xs text-muted">{a.email}</span>
                    </td>
                    <td className={td}>{a.country}</td>
                    <td className={td}>{day.format(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.nextCursor ? (
          <p className="mt-4">
            <Link href={`/admin/applications?status=${status}&cursor=${page.nextCursor}`} className={btnSecondary}>
              Load more
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}

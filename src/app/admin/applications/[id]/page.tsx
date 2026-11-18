import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, link, pageTitle } from "@/components/ui";
import { getApplication } from "@/server/applications";
import { requireAdmin } from "@/server/auth/guards";
import { approveAction, rejectAction } from "../actions";
import { ReviewForms } from "../review-forms";

export const metadata: Metadata = { title: "Application · Apolles", robots: { index: false, follow: false } };

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

// One application. Everything is shown as plain text (the website is not made a link: it is
// whatever the applicant typed).
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const a = await getApplication(id);
  if (!a) notFound();
  const rows: [string, string][] = [
    ["Agency name", a.agencyName],
    ["Contact name", a.contactName],
    ["Business email", a.email],
    ["Phone", a.phone],
    ["Country", a.country],
    ["Website or social page", a.website],
    ["IATA / TIDS / license", a.license || "—"],
    ["Notes", a.notes || "—"],
    ["Applied", `${when.format(a.createdAt)} UTC`],
  ];
  return (
    <main className="flex-1">
      <div className="mx-auto w-[min(900px,calc(100%-40px))] pb-16 pt-8">
        <Link href="/admin/applications" className={link}>
          ← Applications
        </Link>
        <h1 className={`${pageTitle} mt-3`}>{a.agencyName}</h1>
        <p className="mt-1 text-[13px] text-muted">Status: {a.status.toLowerCase()}</p>
        <section className={`${card} mt-5 p-6`}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="whitespace-pre-line break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 border-t border-line pt-5">
            {a.status === "PENDING" ? (
              <ReviewForms id={a.id} approve={approveAction} reject={rejectAction} />
            ) : a.status === "REJECTED" ? (
              <p className="text-sm text-muted">This application was rejected.</p>
            ) : a.agencyId ? (
              <Link href={`/admin/agencies/${a.agencyId}/wallet`} className={link}>
                Open the agency
              </Link>
            ) : (
              <p className="text-sm text-muted">Approved. The agency is in the agencies list (it could not be linked here).</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

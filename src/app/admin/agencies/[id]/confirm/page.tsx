import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btnDanger, btnPrimary, card, link } from "@/components/ui";
import { getAgencySummary } from "@/server/admin/agencies";
import { requireAdmin } from "@/server/auth/guards";
import { setAgencyStatusAction } from "../../actions";

export const metadata: Metadata = { title: "Confirm · Apolles", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
};

// Step 2 of suspend / reactivate: nothing changes until this form is posted.
export default async function ConfirmStatusPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  const { status } = await searchParams;
  if (status !== "SUSPENDED" && status !== "ACTIVE") notFound();
  const agency = await getAgencySummary(id);
  if (!agency) notFound();

  const suspend = status === "SUSPENDED";
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={`w-full max-w-[460px] p-6 ${card}`}>
        <h1 className="mb-2 font-serif text-[28px] font-medium leading-tight text-ink">
          {suspend ? "Suspend agency?" : "Reactivate agency?"}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {suspend
            ? `${agency.name} will be signed out at once and will not be able to sign in until you reactivate it.`
            : `${agency.name} will be able to sign in again.`}
        </p>
        <form action={setAgencyStatusAction} className="flex items-center gap-4">
          <input type="hidden" name="agencyId" value={agency.id} />
          <input type="hidden" name="status" value={status} />
          <button type="submit" className={suspend ? btnDanger : btnPrimary}>
            {suspend ? "Suspend" : "Reactivate"}
          </button>
          <Link href="/admin/agencies" className={link}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  );
}

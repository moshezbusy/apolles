import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
    <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">
          {suspend ? "Suspend agency?" : "Reactivate agency?"}
        </h1>
        <p className="mb-6 text-sm text-gray-600">
          {suspend
            ? `${agency.name} will be signed out at once and will not be able to sign in until you reactivate it.`
            : `${agency.name} will be able to sign in again.`}
        </p>
        <form action={setAgencyStatusAction} className="flex items-center gap-4">
          <input type="hidden" name="agencyId" value={agency.id} />
          <input type="hidden" name="status" value={status} />
          <button
            type="submit"
            className={`rounded-md px-4 py-2 font-medium text-white ${
              suspend ? "bg-red-700 hover:bg-red-800" : "bg-blue-700 hover:bg-blue-800"
            }`}
          >
            {suspend ? "Suspend" : "Reactivate"}
          </button>
          <Link href="/admin/agencies" className="text-sm text-blue-700 hover:underline">
            Cancel
          </Link>
        </form>
      </div>
    </main>
  );
}

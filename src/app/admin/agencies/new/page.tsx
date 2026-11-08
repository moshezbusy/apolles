import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/guards";
import { createAgencyAction } from "../actions";
import { CreateAgencyForm } from "../create-form";

export const metadata: Metadata = { title: "New agency · Apolles", robots: { index: false, follow: false } };

export default async function NewAgencyPage() {
  await requireAdmin();
  return (
    <main className="flex flex-1 justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/admin/agencies" className="text-sm text-blue-700 hover:underline">
          ← Agencies
        </Link>
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">New agency</h1>
          <p className="mb-6 text-sm text-gray-600">
            The agent gets an email with a link to set their password.
          </p>
          <CreateAgencyForm action={createAgencyAction} />
        </div>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { card, link, pageTitle } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guards";
import { createAgencyAction } from "../actions";
import { CreateAgencyForm } from "../create-form";

export const metadata: Metadata = { title: "New agency · Apolles", robots: { index: false, follow: false } };

export default async function NewAgencyPage() {
  await requireAdmin();
  return (
    <main className="flex flex-1 justify-center px-4 pb-16 pt-8">
      <div className="w-full max-w-[480px]">
        <Link href="/admin/agencies" className={link}>
          ← Agencies
        </Link>
        <h1 className={`mt-3 ${pageTitle}`}>New agency</h1>
        <p className="mb-5 mt-1 text-[13px] text-muted">
          The agent gets an email with a link to set their password.
        </p>
        <div className={`${card} p-6`}>
          <CreateAgencyForm action={createAgencyAction} />
        </div>
      </div>
    </main>
  );
}

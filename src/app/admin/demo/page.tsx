import type { Metadata } from "next";
import { card, pageTitle } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guards";
import { isDemoSupplier } from "@/server/supplier";
import { demoAccessAction } from "./actions";
import { DemoAccessForm } from "./demo-access-form";

export const metadata: Metadata = { title: "Demo access · Admin · Apolles", robots: { index: false, follow: false } };

// Admin: a ready agent login for trying the staging demo (Demo Travel Agency, USD 10,000 of
// demo balance). Only in demo mode; the password is made on the click and shown once.
export default async function DemoAccessPage() {
  await requireAdmin();
  return (
    <main className="mx-auto w-[min(800px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Demo access</h1>
      <section className={`${card} mt-5 bg-white p-6`}>
        {isDemoSupplier() ? (
          <>
            <p className="mb-4 text-sm text-[#37413d]">
              A ready agent login for the demo: <strong>Demo Travel Agency</strong>, with USD 10,000 of demo balance. Use it in a private window, so this admin session stays signed in.
            </p>
            <DemoAccessForm action={demoAccessAction} />
          </>
        ) : (
          <p className="text-sm text-muted">Demo access exists only in the staging demo.</p>
        )}
      </section>
    </main>
  );
}

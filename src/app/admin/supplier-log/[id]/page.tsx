import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, link, pageTitle, sectionTitle } from "@/components/ui";
import { getSupplierCall } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Supplier call · Admin · Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// One supplier call: request and response bodies, as stored (already masked), shown as text.
export default async function SupplierCallPage({ params }: { params: Params }) {
  await requireAdmin();
  const { id } = await params;
  const call = await getSupplierCall(id);
  if (!call) notFound();
  const show = (value: unknown) => (value === null || value === undefined ? "—" : JSON.stringify(value, null, 2).slice(0, 200_000));
  return (
    <main className="mx-auto w-[min(1100px,calc(100%-40px))] flex-1 py-8">
      <Link href="/admin/supplier-log" className={link}>
        ← Supplier log
      </Link>
      <h1 className={`${pageTitle} mt-3 break-all font-mono text-[20px]`}>
        {call.method} {call.path}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {call.createdAt.toISOString().slice(0, 19).replace("T", " ")} UTC · status {call.status ?? call.error ?? "—"} · {call.durationMs} ms
        {call.affiliateReferenceId ? ` · booking ${call.affiliateReferenceId}` : ""}
      </p>
      {call.unknownFields.length > 0 ? <p className="mt-2 text-xs text-muted">Unknown fields dropped: {call.unknownFields.join(", ")}</p> : null}
      {(["Request", "Response"] as const).map((label) => (
        <section key={label} className={`${card} mt-5 bg-white p-5`}>
          <h2 className={sectionTitle}>{label}</h2>
          <pre className="mt-2 max-h-[600px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#f7f5f0] p-3 text-xs">{show(label === "Request" ? call.requestBody : call.responseBody)}</pre>
        </section>
      ))}
    </main>
  );
}

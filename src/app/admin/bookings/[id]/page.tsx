import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, card, cell, link, pageTitle, sectionTitle, table, tbody, td, th, thead } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { getBookingForAdmin } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";

export const metadata: Metadata = { title: "Booking · Admin · Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// Admin: one booking with everything support needs, including the supplier's own itinerary
// number (ER1, admin only), and its full event trail. Read-only in phase 1.
export default async function AdminBookingPage({ params }: { params: Params }) {
  await requireAdmin();
  const { id } = await params;
  const b = await getBookingForAdmin(id);
  if (!b) notFound();
  const rows: [string, string][] = [
    ["Status", STATUS_LABEL[b.status]],
    ["Agency", b.agency.name],
    ["Agent", `${b.user.name} (${b.user.email})`],
    ["Hotel", `${b.hotelName}, ${b.hotelCity} (property ${b.propertyId})`],
    ["Room / rate", `${b.roomName} · room ${b.roomId} · rate ${b.rateId}`],
    ["Stay", `${b.checkin} to ${b.checkout} · ${b.adults} adults${b.childAges.length ? ` · children ${b.childAges.join(", ")}` : ""}`],
    ["Lead guest", `${b.leadGivenName} ${b.leadFamilyName} · ${b.leadEmail} · ${b.leadPhone}`],
    ["Total (as booked)", formatUsd(b.chargedMinor ?? b.totalMinor)],
    ["Supplier itinerary", b.supplierItineraryId ?? "—"],
    ["Hotel confirmation", b.hotelConfirmationId ?? "—"],
    ["Cancellation charge / refund", b.refundMinor !== null ? `${formatUsd(b.cancelChargeMinor ?? 0)} / ${formatUsd(b.refundMinor)}` : "—"],
    ["Reconcile attempts", String(b.reconcileAttempts)],
  ];
  return (
    <main className="mx-auto w-[min(1100px,calc(100%-40px))] flex-1 py-8">
      <Link href="/admin/bookings" className={link}>
        ← All bookings
      </Link>
      <h1 className={`${pageTitle} mt-3`}>Booking {b.reference}</h1>
      {b.needsAttention ? (
        <p role="alert" className={`${alertError} mt-4`}>
          Needs attention: the automatic check with the supplier gave up. Check the booking with the supplier and fix it by hand. {b.failureReason ?? ""}
        </p>
      ) : null}
      <section className={`${card} mt-5 bg-white p-5`}>
        <dl className="grid gap-2 text-[13.5px] sm:grid-cols-[220px_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="font-mono text-[13px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3">
          <Link href={`/admin/supplier-log?ref=${encodeURIComponent(b.reference)}`} className={link}>
            Supplier calls for this booking
          </Link>
        </p>
      </section>
      <section aria-labelledby="events-title" className={`${card} mt-5 bg-white p-5`}>
        <h2 id="events-title" className={sectionTitle}>
          History
        </h2>
        <table className={`${table} mt-3`}>
          <thead className={thead}>
            <tr>
              <th className={th}>When (UTC)</th>
              <th className={th}>Change</th>
              <th className={th}>By</th>
              <th className={th}>Why</th>
            </tr>
          </thead>
          <tbody className={tbody}>
            {b.events.map((e) => (
              <tr key={e.id}>
                <td className={`${cell} text-xs`}>{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td className={td}>
                  {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}
                  {STATUS_LABEL[e.toStatus]}
                </td>
                <td className={td}>{e.actor?.email ?? "System"}</td>
                <td className={td}>{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

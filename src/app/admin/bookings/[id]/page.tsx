import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, alertInfo, card, cell, link, pageTitle, sectionTitle, table, tbody, td, th, thead, tr } from "@/components/ui";
import { oneRoomConfirmation, roomGuestLines, roomHeading } from "@/lib/guests";
import { formatUsd } from "@/lib/money";
import { getBookingForAdmin } from "@/server/admin/bookings";
import { requireAdmin } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";
import { adminCancelQuote } from "@/server/booking/service";
import { CancelForAgentForm, CheckNowForm, RefundForm, ReleaseHoldForm, ResolveForm } from "./booking-actions";

export const metadata: Metadata = { title: "Booking · Admin · Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// Admin: one booking with everything support needs, including the supplier's own itinerary
// number (ER1, admin only), and its full event trail. A booking of several rooms (plan 10) has a
// table of its rooms; the supplier's cancel links are never read here. The admin's tools for the
// booking are on the right (booking-actions.tsx): each is shown only in the status it applies to,
// and the server checks the status again.
export default async function AdminBookingPage({ params }: { params: Params }) {
  await requireAdmin();
  const { id } = await params;
  const b = await getBookingForAdmin(id);
  if (!b) notFound();
  const severalRooms = b.rooms.length > 1;
  const paid = b.chargedMinor ?? b.totalMinor;
  const quote = b.status === "CONFIRMED" ? await adminCancelQuote(b.id) : null;
  const checkable = b.status === "PENDING_CONFIRMATION" || b.status === "CANCEL_PENDING" || b.status === "CONFIRMED" || b.status === "FAILED";
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
    ["Hotel confirmation", severalRooms ? "One for each room, under Rooms" : (oneRoomConfirmation(b, b.rooms) ?? "—")],
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
          Needs attention: check this booking with the supplier, fix it with the tools on this page, then mark it resolved. The history below says why it was flagged. {b.failureReason ?? ""}
        </p>
      ) : null}
      {b.changeRequests.length > 0 ? (
        <p role="status" className={`${alertInfo} mt-4`}>
          The agent asked for a change to this booking.{" "}
          <Link href={`/admin/change-requests?booking=${encodeURIComponent(b.id)}`} className={link}>
            Open the change requests
          </Link>
        </p>
      ) : null}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
      <section className={`${card} bg-white p-5`}>
        <dl className="grid gap-2 text-[13.5px] sm:grid-cols-[220px_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="font-mono text-[13px]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <Link href={`/admin/supplier-log?ref=${encodeURIComponent(b.reference)}`} className={link}>
            Supplier calls for this booking
          </Link>
          <Link href={`/admin/agencies/${encodeURIComponent(b.agency.id)}/wallet`} className={link}>
            {b.agency.name} wallet
          </Link>
          <Link href={`/admin/bookings?agency=${encodeURIComponent(b.agency.id)}`} className={link}>
            Bookings of this agency
          </Link>
        </p>
      </section>
      <aside aria-label="Admin tools" className="flex flex-col gap-4">
        {b.needsAttention ? <ResolveForm bookingId={b.id} /> : null}
        {checkable ? <CheckNowForm bookingId={b.id} /> : null}
        {quote?.allowed ? <CancelForAgentForm bookingId={b.id} reference={b.reference} chargeMinor={quote.chargeMinor} refundMinor={quote.refundMinor} /> : null}
        {b.status === "CONFIRMED" && quote && !quote.allowed ? (
          <p className={`${alertInfo}`}>Cancel for the agent: {quote.reason}</p>
        ) : null}
        {b.status === "CANCELLED_BY_SUPPLIER" && b.refundMinor === null ? <RefundForm bookingId={b.id} paidMinor={paid} /> : null}
        {b.status === "PENDING_CONFIRMATION" && b.holdId ? <ReleaseHoldForm bookingId={b.id} heldMinor={paid} /> : null}
      </aside>
      </div>
      {severalRooms ? (
        <section aria-labelledby="rooms-title" className={`${card} mt-5 bg-white p-5`}>
          <h2 id="rooms-title" className={sectionTitle}>
            Rooms
          </h2>
          <table className={`${table} mt-3`}>
            <thead className={thead}>
              <tr>
                <th className={th}>Room</th>
                <th className={th}>Guests</th>
                <th className={th}>Supplier room</th>
                <th className={th}>Hotel confirmation</th>
                <th className={th}>Status</th>
                <th className={th}>Price</th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {b.rooms.map((room) => (
                <tr key={room.id} className={tr}>
                  <td data-label="Room" className={cell}>{roomHeading(room.index, room)}</td>
                  <td data-label="Guests" className={td}>
                    <ul>
                      {roomGuestLines(room).map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </td>
                  <td data-label="Supplier room" className={`${td} font-mono text-[13px]`}>{room.supplierRoomId ?? "—"}</td>
                  <td data-label="Hotel confirmation" className={`${td} font-mono text-[13px]`}>{room.hotelConfirmationId ?? "—"}</td>
                  <td data-label="Status" className={td}>
                    {room.status === "CANCELLED" ? "Cancelled" : room.cancelRequestedAt ? "Active · cancel sent" : "Active"}
                    {room.cancelledAt ? <span className="block text-xs text-muted">{room.cancelledAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span> : null}
                  </td>
                  <td data-label="Price" className={`${td} tabular-nums`}>{formatUsd(room.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
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
              <tr key={e.id} className={tr}>
                <td data-label="When (UTC)" className={`${cell} text-xs`}>{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td data-label="Change" className={td}>
                  {e.fromStatus === e.toStatus ? `Note (${STATUS_LABEL[e.toStatus]})` : `${e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}${STATUS_LABEL[e.toStatus]}`}
                </td>
                <td data-label="By" className={td}>{e.actor?.email ?? "System"}</td>
                <td data-label="Why" className={td}>{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

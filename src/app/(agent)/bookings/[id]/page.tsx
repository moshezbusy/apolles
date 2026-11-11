import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, alertInfo, alertSuccess, btnDanger, card, link, pageTitle, sectionTitle } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { supportContact } from "@/server/app-info";
import { requireAgent } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";
import { cancelQuote, getBooking } from "@/server/booking/service";
import type { CancelPenalty, PriceBreakdown } from "@/server/supplier/types";
import { guestLines } from "../../_components/guests";
import { CancellationPolicy, PriceDetails } from "../../_components/hotel-info";
import { shortDate, stayText } from "../../search/parts";
import { cancelAction } from "./actions";

export const metadata: Metadata = { title: "Booking | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NOTICES: Record<string, { tone: "ok" | "info" | "error"; text: string }> = {
  cancelled: { tone: "ok", text: "The booking is cancelled. The refund is in your balance." },
  cancel_pending: { tone: "info", text: "The cancellation was sent. We are waiting for the hotel to confirm it; the refund follows." },
  cancel_refused: { tone: "error", text: "The hotel did not accept the cancellation. Contact Apolles support." },
  cancel_not_allowed: { tone: "error", text: "This booking cannot be cancelled online right now. Contact Apolles support." },
};

const STATUS_TONE: Record<string, string> = {
  CONFIRMED: "bg-brand-soft text-brand",
  PENDING_CONFIRMATION: "bg-[#fff2c7] text-[#6f5a20]",
  CANCEL_PENDING: "bg-[#fff2c7] text-[#6f5a20]",
  FAILED: "bg-[#fbecea] text-[#9b3b2e]",
  CANCELLED: "bg-[#f1efe9] text-[#5f6863]",
  CANCELLED_BY_SUPPLIER: "bg-[#fbecea] text-[#9b3b2e]",
};

// Screen 12: one booking of the agency, with its status, references, stay, price and policy,
// and cancellation (today's charge first). Voucher and invoice PDFs come in plan 4.
export default async function BookingPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const q = await searchParams;
  const b = await getBooking(agencyId, id);
  if (!b || b.status === "DRAFT" || b.status === "EXPIRED") notFound();
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const price = b.price as unknown as PriceBreakdown;
  const stay = stayText({ nights: price.nights, adults: b.adults, childAges: b.childAges });
  const quote = cancelQuote(b, new Date());
  const support = supportContact();

  return (
    <main className="mx-auto w-[min(1100px,calc(100%-40px))] py-8">
      <Link href="/bookings" className={link}>
        ← All bookings
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className={pageTitle}>Booking {b.reference}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_TONE[b.status] ?? ""}`}>{STATUS_LABEL[b.status]}</span>
      </div>
      {notice ? (
        <p role="status" className={`${notice.tone === "ok" ? alertSuccess : notice.tone === "info" ? alertInfo : alertError} mt-4`}>
          {notice.text}
        </p>
      ) : null}
      {b.status === "PENDING_CONFIRMATION" ? (
        <p role="status" className={`${alertInfo} mt-4`}>
          Waiting for the hotel to confirm. {formatUsd(b.totalMinor)} is on hold from your balance until then. This page shows the result as soon as it arrives.
        </p>
      ) : null}
      {b.status === "FAILED" ? (
        <p role="status" className={`${alertError} mt-4`}>
          The hotel did not confirm this booking. Nothing was charged: the money is back in your balance.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="refs-title" className={`${card} bg-white p-5`}>
            <h2 id="refs-title" className={sectionTitle}>
              {b.hotelName}
            </h2>
            <p className="text-[13px] text-muted">{b.hotelCity}</p>
            <dl className="mt-3 grid gap-3 text-[13.5px] sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink">Apolles reference</dt>
                <dd className="font-mono">{b.reference}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Hotel confirmation</dt>
                <dd className="font-mono">{b.hotelConfirmationId ?? (b.status === "CONFIRMED" ? "Shown here once the hotel sends it" : "—")}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Room</dt>
                <dd>{b.roomName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Bed type</dt>
                <dd>
                  {b.bedDescription} <span className="block text-xs text-muted">Bed type is a request and not guaranteed.</span>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Dates</dt>
                <dd>
                  {shortDate(b.checkin)} to {shortDate(b.checkout)} · {stay}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Guests</dt>
                <dd>
                  <ul>
                    {guestLines(b.guests as { givenName: string; familyName: string }[], b.adults, b.childAges).map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Lead guest contact</dt>
                <dd>
                  {b.leadEmail} · {b.leadPhone}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Voucher</dt>
                <dd>
                  {b.status === "CONFIRMED" ? (
                    <a href={`/bookings/${b.id}/voucher`} className={link}>
                      Download voucher (PDF)
                    </a>
                  ) : (
                    <span className="text-muted">Available once the booking is confirmed</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section aria-labelledby="policy-title" className={`${card} bg-white p-5`}>
            <h2 id="policy-title" className={sectionTitle}>
              Cancellation policy
            </h2>
            <div className="mt-2">
              <CancellationPolicy refundable={b.refundable} penalties={b.cancelPenalties as unknown as CancelPenalty[]} nonrefundableDateRanges={b.nonrefundableDateRanges as unknown as { start: string; end: string }[]} />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <section aria-labelledby="paid-title" className={`${card} bg-white p-5`}>
            <h2 id="paid-title" className={sectionTitle}>
              Price
            </h2>
            <div className="mt-2">
              <PriceDetails price={price} stay={stay} />
            </div>
            {b.status === "CANCELLED" && b.refundMinor !== null ? (
              <p className="mt-3 border-t border-line pt-3 text-[13px]">
                Cancellation charge {formatUsd(b.cancelChargeMinor ?? 0)} · Refunded {formatUsd(b.refundMinor)}
              </p>
            ) : null}
          </section>

          {b.status === "CONFIRMED" ? (
            <section aria-labelledby="cancel-title" className={`${card} bg-white p-5`}>
              <h2 id="cancel-title" className={sectionTitle}>
                Cancel booking
              </h2>
              {quote.allowed ? (
                <form action={cancelAction} className="mt-2 flex flex-col gap-3 text-[13px]">
                  <p>
                    Cancelling today costs <strong>{formatUsd(quote.chargeMinor)}</strong>. {formatUsd(quote.refundMinor)} goes back to your balance once the hotel confirms the cancellation.
                  </p>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <input type="hidden" name="expectedCharge" value={quote.chargeMinor} />
                  <button type="submit" className={btnDanger}>
                    Confirm cancellation
                  </button>
                </form>
              ) : (
                <p className="mt-2 text-[13px] text-muted">{quote.reason}</p>
              )}
            </section>
          ) : null}
          <p className="text-xs text-muted">
            Apolles support: {support.email ?? "email not set yet"}
            {support.phone ? ` · ${support.phone}` : ""}
          </p>
        </aside>
      </div>
    </main>
  );
}

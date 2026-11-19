import type { Metadata } from "next";
import { RateIncludes } from "@/components/RateIncludes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, alertInfo, alertSuccess, btnDanger, card, link, pageTitle, sectionTitle } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { supportContact } from "@/server/app-info";
import { requireAgent } from "@/server/auth/guards";
import { STATUS_LABEL } from "@/server/booking/list";
import { cancelQuote, getBooking, getBookingRooms } from "@/server/booking/service";
import { getContent } from "@/server/content/content-cache";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";
import { type StoredGuest, guestLines, oneRoomConfirmation, roomGuestLines, roomHeading } from "../../_components/guests";
import { CancellationPolicy, Policies, PriceDetails } from "../../_components/hotel-info";
import { shortDate, stayText } from "../../search/parts";
import { SellingPrice } from "../../_components/selling-price";
import { cancelAction, emailClientAction, sellingPriceAction } from "./actions";
import { EmailToClient } from "./email-client";
import { clientEmailDefault } from "@/server/booking/client-email";

export const metadata: Metadata = { title: "Booking | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NOTICES: Record<string, { tone: "ok" | "info" | "error"; text: string }> = {
  cancelled: { tone: "ok", text: "The booking is cancelled. The refund is in your balance." },
  cancel_pending: { tone: "info", text: "The cancellation was sent. We are waiting for the hotel to confirm it; the refund follows." },
  cancel_refused: { tone: "error", text: "The hotel did not accept the cancellation. Contact Apolles support." },
  cancel_part_refused: { tone: "error", text: "The hotel did not cancel every room. Apolles support will finish the cancellation; the refund follows once every room is cancelled." },
  cancel_not_allowed: { tone: "error", text: "This booking cannot be cancelled online right now. Contact Apolles support." },
  cancel_confirm: { tone: "info", text: "Nothing was cancelled. Tick \"I understand\" to confirm the cancellation." },
};

const PAID_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const STATUS_TONE: Record<string, string> = {
  CONFIRMED: "bg-brand-soft text-brand",
  PENDING_CONFIRMATION: "bg-[#fff2c7] text-[#6f5a20]",
  CANCEL_PENDING: "bg-[#fff2c7] text-[#6f5a20]",
  FAILED: "bg-[#fbecea] text-[#9b3b2e]",
  CANCELLED: "bg-[#f1efe9] text-[#5f6863]",
  CANCELLED_BY_SUPPLIER: "bg-[#fbecea] text-[#9b3b2e]",
};

// Screen 12: one booking of the agency, with its status, references, stay, price and policy,
// and cancellation (today's charge first). Voucher and invoice PDFs come in plan 4. A booking of
// several rooms (plan 10) has a Rooms card (each room's guests, hotel confirmation and price); a
// one-room booking looks as before.
export default async function BookingPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const q = await searchParams;
  const b = await getBooking(agencyId, id);
  if (!b || b.status === "DRAFT" || b.status === "EXPIRED") notFound();
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;
  const price = b.price as unknown as PriceBreakdown;
  // Plan 10: the charge is every room's own charge, added up (the rooms read without their supplier links).
  const rooms = await getBookingRooms(agencyId, b.id);
  const severalRooms = rooms.length > 1;
  const stay = stayText({ nights: price.nights, rooms: severalRooms ? rooms : [{ adults: b.adults, childAges: b.childAges }] });
  const waitingText = b.status === "CONFIRMED" ? "Shown here once the hotel sends it" : "—";
  const quote = cancelQuote(b, rooms, new Date());
  const support = supportContact();
  // Hotel policies after booking too (EXP), best effort: the booking page works without them.
  let content: PropertyContent | null = null;
  try {
    content = (await getContent([b.propertyId])).get(b.propertyId) ?? null;
  } catch {
    content = null;
  }

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
              {severalRooms ? null : (
                <div>
                  <dt className="font-semibold text-ink">Hotel confirmation</dt>
                  <dd className="font-mono">{oneRoomConfirmation(b, rooms) ?? waitingText}</dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-ink">Room</dt>
                <dd>
                  {b.roomName}
                  <RateIncludes amenities={b.amenities} className="text-xs text-muted" />
                </dd>
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
              {severalRooms ? null : (
                <div>
                  <dt className="font-semibold text-ink">Guests</dt>
                  <dd>
                    <ul>
                      {guestLines(b.guests as StoredGuest[], b.adults, b.childAges).map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {b.specialRequest ? (
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-ink">Special requests</dt>
                  <dd>
                    {b.specialRequest} <span className="block text-xs text-muted">Sent to the hotel. Requests are not guaranteed.</span>
                  </dd>
                </div>
              ) : null}
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
                    <>
                      <a href={`/bookings/${b.id}/voucher`} className={link}>
                        Download voucher (PDF)
                      </a>
                      <EmailToClient action={emailClientAction} bookingId={b.id} defaultEmail={await clientEmailDefault(agencyId, b.id)} />
                    </>
                  ) : (
                    <span className="text-muted">Available once the booking is confirmed</span>
                  )}
                </dd>
              </div>
              {b.chargedMinor !== null && ["CONFIRMED", "CANCEL_PENDING", "CANCELLED", "CANCELLED_BY_SUPPLIER"].includes(b.status) ? (
                <div>
                  <dt className="font-semibold text-ink">Statement</dt>
                  <dd>
                    <a href={`/bookings/${b.id}/statement`} className={link}>
                      Download statement (PDF)
                    </a>
                    <span className="block text-xs text-muted">What was paid from your balance. Not a tax invoice; for you, not the client.</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
          {severalRooms ? (
            <section aria-labelledby="rooms-title" className={`${card} bg-white p-5`}>
              <h2 id="rooms-title" className={sectionTitle}>
                Rooms
              </h2>
              <ol className="mt-3 grid gap-3 text-[13.5px]">
                {rooms.map((room) => (
                  <li key={room.index} className="rounded-lg border border-line p-3">
                    <p className="flex flex-wrap justify-between gap-3 font-semibold text-ink">
                      <span>
                        {roomHeading(room.index, room)}
                        {room.status === "CANCELLED" ? <span className="ml-2 rounded-full bg-[#f1efe9] px-2 py-0.5 text-xs font-bold text-[#5f6863]">Cancelled</span> : null}
                      </span>
                      <span className="tabular-nums">{formatUsd(room.totalMinor)}</span>
                    </p>
                    <ul className="mt-1">
                      {roomGuestLines(room).map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold text-ink">Main guest</dt>
                        <dd>
                          {room.givenName} {room.familyName}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-ink">Hotel confirmation</dt>
                        <dd className="font-mono">{room.hotelConfirmationId ?? waitingText}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <section aria-labelledby="policy-title" className={`${card} bg-white p-5`}>
            <h2 id="policy-title" className={sectionTitle}>
              Cancellation policy
            </h2>
            <div className="mt-2">
              <CancellationPolicy refundable={b.refundable} penalties={b.cancelPenalties as unknown as CancelPenalty[]} nonrefundableDateRanges={b.nonrefundableDateRanges as unknown as { start: string; end: string }[]} />
            </div>
          </section>
          {content ? <Policies content={content} /> : null}
        </div>

        <aside className="flex flex-col gap-5">
          <section aria-labelledby="paid-title" className={`${card} bg-white p-5`}>
            <h2 id="paid-title" className={sectionTitle}>
              Price
            </h2>
            <div className="mt-2">
              <PriceDetails price={price} stay={stay} />
            </div>
            {b.chargedMinor !== null && b.status !== "FAILED" ? (
              <p className="mt-3 border-t border-line pt-3 text-[13px] text-[#37413d]">
                Payment · Paid from balance{" "}
                {b.status === "PENDING_CONFIRMATION" ? "(held until the hotel confirms)" : b.confirmedAt ? `· Deducted on ${PAID_DAY.format(b.confirmedAt)}` : ""}
              </p>
            ) : null}
            {b.status === "CANCELLED" && b.refundMinor !== null ? (
              <p className="mt-3 border-t border-line pt-3 text-[13px]">
                Cancellation charge {formatUsd(b.cancelChargeMinor ?? 0)} · Refunded {formatUsd(b.refundMinor)}
              </p>
            ) : null}
            {b.status !== "FAILED" ? (
              <div className="mt-4 border-t border-line pt-4">
                <SellingPrice
                  action={sellingPriceAction}
                  bookingId={b.id}
                  netMinor={b.chargedMinor ?? b.totalMinor}
                  saved={b.sellMarkupType && b.sellMarkupValue !== null ? { markupType: b.sellMarkupType, markupValue: b.sellMarkupValue } : null}
                  title="Your selling price"
                />
              </div>
            ) : null}
          </section>

          {b.status === "CONFIRMED" ? (
            <section aria-labelledby="cancel-title" className={`${card} bg-white p-5`}>
              <h2 id="cancel-title" className={sectionTitle}>
                Cancel booking
              </h2>
              {quote.allowed ? (
                <form action={cancelAction} className="mt-2 flex flex-col gap-3 text-[13px]">
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 rounded-[12px] bg-[#f7f5f0] p-3">
                    <dt className="text-muted">Paid</dt>
                    <dd className="text-right font-semibold tabular-nums">{formatUsd(quote.chargeMinor + quote.refundMinor)}</dd>
                    <dt className="text-muted">Charge if you cancel now</dt>
                    <dd className="text-right font-semibold tabular-nums text-[#9b3b2e]">{formatUsd(quote.chargeMinor)}</dd>
                    <dt className="text-muted">Returned to your balance</dt>
                    <dd className="text-right font-bold tabular-nums text-brand">{formatUsd(quote.refundMinor)}</dd>
                  </dl>
                  {rooms.length > 1 ? <p className="text-muted">{`Cancelling cancels all ${rooms.length} rooms of this booking.`}</p> : null}
                  <p className="text-muted">The refund is added once the hotel confirms the cancellation.</p>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <input type="hidden" name="expectedCharge" value={quote.chargeMinor} />
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="confirmFinal" required className="mt-0.5 h-4 w-4 accent-[#9b3b2e]" />
                    <span>I understand that cancelling is final and cannot be undone.</span>
                  </label>
                  <button type="submit" className={btnDanger}>
                    Cancel this booking
                  </button>
                  <p className="text-xs text-muted">Changed your mind? Do nothing: the booking stays as it is.</p>
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

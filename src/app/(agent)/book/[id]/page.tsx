import type { Metadata } from "next";
import { RateIncludes } from "@/components/RateIncludes";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { alertError, alertInfo, card, link, pageTitle, sectionTitle } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { supportContact, termsLinks } from "@/server/app-info";
import { requireAgent } from "@/server/auth/guards";
import { BookingUnavailable, getBooking, getBookingRooms, prepareReview } from "@/server/booking/service";
import { getContent } from "@/server/content/content-cache";
import { supplierContextFrom } from "@/server/supplier-context";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";
import { getBalance } from "@/server/wallet/ledger";
import { type StoredGuest, guestLines, roomGuestLines, roomTitle } from "../../_components/guests";
import { CancellationPolicy, Policies, PriceDetails } from "../../_components/hotel-info";
import { shortDate, stayText } from "../../search/parts";
import { bookAction } from "../actions";
import { SellingPrice } from "../../_components/selling-price";
import { sellingPriceAction } from "../../bookings/[id]/actions";
import { formatMinor } from "@/lib/supplier-money";
import { freeCancelText } from "@/server/booking/free-cancel";
import { getQuoteSettings } from "@/server/quote-settings";
import { type QuoteReview, quoteReview } from "@/server/quotes/quote-booking";
import { quoteCode } from "@/server/quotes/quotes";
import { Steps } from "../../_components/steps";
import { BookForm } from "./book-form";

export const metadata: Metadata = { title: "Review and book | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-[min(1100px,calc(100%-40px))] py-8">{children}</main>;
}

// Screen 11: the price checked again with the supplier, everything Expedia requires before
// booking, the balance, one terms box, and one button.
export default async function ReviewPage({ params }: { params: Params }) {
  const { agencyId, userId } = await requireAgent();
  const { id } = await params;
  const existing = await getBooking(agencyId, id);
  if (!existing) notFound();
  if (existing.status !== "DRAFT") redirect(`/bookings/${existing.id}`);

  let review;
  try {
    review = await prepareReview({ agencyId, userId, supplierContext: supplierContextFrom(await headers()) }, existing.id);
  } catch (error) {
    if (!(error instanceof BookingUnavailable)) throw error;
    return (
      <Shell>
        <h1 className={pageTitle}>Review and book</h1>
        <p role="alert" className={`${alertError} mt-5`}>
          {error.message} <Link href={`/book/${existing.id}`} className={link}>Try again</Link>
        </p>
      </Shell>
    );
  }
  if (review.kind === "not_draft") redirect(`/bookings/${existing.id}`);
  if (review.kind === "sold_out") {
    return (
      <Shell>
        <h1 className={pageTitle}>Review and book</h1>
        <p role="alert" className={`${alertInfo} mt-5`}>
          This room is no longer available at this price. <Link href="/search" className={link}>Search again</Link>
        </p>
      </Shell>
    );
  }

  const b = review.booking;
  let content: PropertyContent | null = null;
  try {
    content = (await getContent([b.propertyId])).get(b.propertyId) ?? null;
  } catch {
    content = null; // the rates and policies of the rate itself are still shown
  }
  // From a quote: what the client was quoted, next to what was just checked (the quote never sets the price).
  const [{ balanceCents }, rooms, fromQuote, settings] = await Promise.all([getBalance(agencyId), getBookingRooms(agencyId, b.id), quoteReview(agencyId, b), getQuoteSettings(agencyId)]);
  const shortfall = Math.max(0, b.totalMinor - balanceCents);
  // Several rooms (plan 10) list each room with its guests and price; one room looks as before.
  const severalRooms = rooms.length > 1;
  const stay = stayText({ nights: (b.price as unknown as PriceBreakdown).nights, rooms: severalRooms ? rooms : [{ adults: b.adults, childAges: b.childAges }] });
  const support = supportContact();
  const changed = b.previousTotalMinor !== null && b.previousTotalMinor !== b.totalMinor;

  return (
    <Shell>
      <Steps current={4} />
      <h1 className={pageTitle}>Review and book</h1>
      <p className="mt-1 text-sm text-muted">The price below was checked with the hotel just now.</p>
      {changed ? (
        <p role="alert" className={`${alertInfo} mt-4`}>
          The price changed since your search: was {formatUsd(b.previousTotalMinor!)}, now {formatUsd(b.totalMinor)}. Book below to continue at {formatUsd(b.totalMinor)}, or{" "}
          <Link href={b.snapshotId ? `/search/${b.snapshotId}/hotels/${b.propertyId}` : "/search"} className={link}>
            go back to the room options
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          <section aria-labelledby="stay-title" className={`${card} bg-white p-5`}>
            <h2 id="stay-title" className={sectionTitle}>
              {b.hotelName}
            </h2>
            <p className="text-[13px] text-muted">{b.hotelCity}</p>
            <dl className="mt-3 grid gap-2 text-[13.5px] sm:grid-cols-2">
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
              {severalRooms ? (
                <div className="sm:col-span-2">
                  <dt className="font-semibold text-ink">Rooms and guests</dt>
                  <dd>
                    <ol className="mt-1 grid gap-2">
                      {rooms.map((room) => (
                        <li key={room.index} className="rounded-lg border border-line p-3">
                          <p className="flex justify-between gap-3 font-semibold text-ink">
                            <span>{roomTitle(room.index, room)}</span> <span className="tabular-nums">{formatUsd(room.totalMinor)}</span>
                          </p>
                          <ul>
                            {roomGuestLines(room).map((g, i) => (
                              <li key={i}>{g}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  </dd>
                </div>
              ) : (
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
              <div className="sm:col-span-2">
                <dt className="font-semibold text-ink">Lead guest contact</dt>
                <dd>
                  {b.leadEmail} · {b.leadPhone} <span className="block text-xs text-muted">Sent to the hotel with the booking.</span>
                </dd>
              </div>
            </dl>
            <p className="mt-3">
              <Link href={`/book/${b.id}/edit`} className={link}>
                Edit guest details
              </Link>
            </p>
          </section>
          <section aria-labelledby="cancel-title" className={`${card} bg-white p-5`}>
            <h2 id="cancel-title" className={sectionTitle}>
              Cancellation policy
            </h2>
            <div className="mt-2">
              <CancellationPolicy refundable={b.refundable} penalties={b.cancelPenalties as unknown as CancelPenalty[]} nonrefundableDateRanges={b.nonrefundableDateRanges as unknown as { start: string; end: string }[]} />
            </div>
          </section>
          {content ? <Policies content={content} /> : null}
        </div>

        <aside className="flex flex-col gap-5">
          {fromQuote ? <FromQuote review={fromQuote} /> : null}
          <section aria-labelledby="price-title" className={`${card} bg-white p-5`}>
            <h2 id="price-title" className={sectionTitle}>
              Price
            </h2>
            <div className="mt-2">
              <PriceDetails price={b.price as unknown as PriceBreakdown} stay={stay} />
            </div>
            <div className="mt-4 border-t border-line pt-3 text-[13px]">
              <p className="flex justify-between">
                <span>Available balance</span> <strong className="tabular-nums">{formatUsd(balanceCents)}</strong>
              </p>
              {shortfall === 0 ? (
                <p className="mt-1 flex justify-between">
                  <span>After this booking</span> <strong className="tabular-nums">{formatUsd(balanceCents - b.totalMinor)}</strong>
                </p>
              ) : null}
              {shortfall > 0 ? (
                <p role="alert" className={`${alertError} mt-2`}>
                  Your balance is not enough for this booking. Missing: {formatUsd(shortfall)}. <Link href="/balance" className={link}>How to top up</Link>
                  <span className="mt-1 block">
                    This booking is kept for 7 days under{" "}
                    <Link href="/bookings?tab=not_finished" className={link}>
                      Bookings, Not finished
                    </Link>
                    : come back to it after the top-up.
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted">The total is paid from your balance when you book.</p>
              )}
            </div>
          </section>
          <section className={`${card} bg-white p-5`}>
            <SellingPrice
              action={sellingPriceAction}
              bookingId={b.id}
              netMinor={b.totalMinor}
              saved={b.sellMarkupType && b.sellMarkupValue !== null ? { markupType: b.sellMarkupType, markupValue: b.sellMarkupValue } : null}
              suggested={settings ? { markupType: settings.defaultMarkupType, markupValue: settings.defaultMarkupValue } : null}
              title="Add your selling price (optional)"
            />
          </section>
          <section className={`${card} bg-white p-5`}>
            <BookForm
              key={b.priceCheckedAt?.toISOString() ?? "unchecked"}
              action={bookAction}
              bookingId={b.id}
              expectedTotal={b.totalMinor}
              terms={termsLinks()}
              canPay={shortfall === 0}
              quoteCheck={fromQuote?.needsCheck === true}
              checkedAt={b.priceCheckedAt?.toISOString() ?? null}
            />
            {(() => {
              // The one wording (free-cancel.ts): only while free cancellation is still open.
              const free = freeCancelText(b, new Date());
              return (
                <p className={`mt-3 text-center text-xs font-semibold ${free ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>
                  {free ?? (b.refundable ? "See the cancellation policy before booking" : "Non-refundable")}
                </p>
              );
            })()}
          </section>
          <p className="text-xs text-muted">
            Questions about this booking? Apolles support: {support.email ?? "email not set yet"}
            {support.phone ? ` · ${support.phone}` : ""}
          </p>
        </aside>
      </div>
    </Shell>
  );
}

// "From quote Q-n": the price and the cancellation date the client was quoted, set against the
// rate as the supplier has it now. Days can pass between a quote and its booking: the net may be
// higher (less profit, or a loss) and free cancellation may be gone. When any of that is worse
// than what was quoted, "Book" asks for a tick (checked again on the server).
function FromQuote({ review }: { review: QuoteReview }) {
  const money = (minor: number) => formatMinor(minor, review.currency);
  const row = "flex justify-between gap-3";
  return (
    <section aria-labelledby="from-quote-title" className={`${card} bg-white p-5`}>
      <h2 id="from-quote-title" className={sectionTitle}>
        From quote{" "}
        <Link href={`/quotes/${review.quoteId}#selections`} className="underline">
          {quoteCode(review.number)}
        </Link>
      </h2>
      {review.rateChanged ? (
        <p role="alert" className={`${alertInfo} mt-2`}>
          The rate changed. The supplier no longer has the exact rate that was quoted: this is another rate of the same hotel. Check the room, what it includes and its cancellation policy on this page.
        </p>
      ) : null}
      <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
        <div className={row}>
          <dt>{review.priced ? "Price quoted to the client" : "The client saw (no markup was set)"}</dt>
          <dd className="font-bold tabular-nums text-ink">{money(review.quotedMinor)}</dd>
        </div>
        {review.chosenAtMinor !== null ? (
          <div className={row}>
            <dt>Price when the client chose</dt>
            <dd className="tabular-nums">{money(review.chosenAtMinor)}</dd>
          </div>
        ) : null}
        <div className={row}>
          <dt>Net now</dt>
          <dd className="tabular-nums">
            <strong className="text-ink">{money(review.netNowMinor)}</strong>
            {review.netNowMinor !== review.netThenMinor ? <span className="block text-xs text-muted">was {money(review.netThenMinor)} when quoted</span> : null}
          </dd>
        </div>
        <div className={row}>
          <dt>Your profit</dt>
          <dd className={`tabular-nums ${review.profitNowMinor <= 0 ? "text-[#9b3b2e]" : "text-ink"}`}>
            <strong>{money(review.profitNowMinor)}</strong>
            {review.profitLower ? <span className="block text-xs">was {money(review.profitThenMinor)}</span> : null}
          </dd>
        </div>
        <div className={row}>
          <dt>Free cancellation the client saw</dt>
          <dd className="text-right">{review.clientFreeDay ? `Until ${shortDate(review.clientFreeDay)}` : review.freeThenDay ? `Not shown (the rate had it until ${shortDate(review.freeThenDay)})` : "None"}</dd>
        </div>
        <div className={row}>
          <dt>Free cancellation now</dt>
          <dd className={`text-right font-bold ${review.freeNowDay ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{review.freeNowDay ? `Until ${shortDate(review.freeNowDay)} (hotel time)` : "None: this booking cannot be cancelled for free"}</dd>
        </div>
      </dl>
      {review.needsCheck ? (
        <p role="alert" className={`${alertError} mt-3`}>
          {[review.profitLower ? "your profit is lower than when the client chose" : "", review.termsWorse ? "the cancellation terms are worse than what was quoted" : "", review.rateChanged ? "the rate is not the one that was quoted" : ""]
            .filter(Boolean)
            .join(", ")
            .replace(/^./, (c) => c.toUpperCase())}
          . Check with the client if needed, then tick the box below to book.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted">The price and the terms are as good as what the client was quoted.</p>
      )}
    </section>
  );
}

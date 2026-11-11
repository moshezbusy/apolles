import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { alertError, alertInfo, card, link, pageTitle, sectionTitle } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import { supportContact, termsLinks } from "@/server/app-info";
import { requireAgent } from "@/server/auth/guards";
import { BookingUnavailable, getBooking, prepareReview } from "@/server/booking/service";
import { getContent } from "@/server/content/content-cache";
import { supplierContextFrom } from "@/server/supplier-context";
import type { CancelPenalty, PriceBreakdown, PropertyContent } from "@/server/supplier/types";
import { getBalance } from "@/server/wallet/ledger";
import { guestLines } from "../../_components/guests";
import { CancellationPolicy, Policies, PriceDetails } from "../../_components/hotel-info";
import { shortDate, stayText } from "../../search/parts";
import { bookAction } from "../actions";
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
  const { balanceCents } = await getBalance(agencyId);
  const shortfall = Math.max(0, b.totalMinor - balanceCents);
  const stay = stayText({ nights: (b.price as unknown as PriceBreakdown).nights, adults: b.adults, childAges: b.childAges });
  const support = supportContact();
  const changed = b.previousTotalMinor !== null && b.previousTotalMinor !== b.totalMinor;

  return (
    <Shell>
      <h1 className={pageTitle}>Review and book</h1>
      <p className="mt-1 text-sm text-muted">The price below was checked with the hotel just now.</p>
      {changed ? (
        <p role="alert" className={`${alertInfo} mt-4`}>
          The price changed since your search: was {formatUsd(b.previousTotalMinor!)}, now {formatUsd(b.totalMinor)}.
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
            </dl>
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
              {shortfall > 0 ? (
                <p role="alert" className={`${alertError} mt-2`}>
                  Missing: {formatUsd(shortfall)}. <Link href="/balance" className={link}>How to top up</Link>
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted">The total is paid from your balance when you book.</p>
              )}
            </div>
          </section>
          <section className={`${card} bg-white p-5`}>
            <BookForm action={bookAction} bookingId={b.id} expectedTotal={b.totalMinor} terms={termsLinks()} canPay={shortfall === 0} />
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

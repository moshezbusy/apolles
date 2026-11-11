import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, btnPrimary, card, link, sectionTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { SearchRateLimited } from "@/server/search/errors";
import { getHotelOffers, searchSummary } from "@/server/search/search";
import type { Offer } from "@/server/supplier/types";
import { HotelPhoto, Stars, shortDate, stayText } from "../../../parts";
import { CancellationPolicy, Policies, PriceDetails, SupplierText } from "../../../../_components/hotel-info";
import { cancellationLabel } from "../../../../_components/rate-text";

export const metadata: Metadata = { title: "Hotel | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string; propertyId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEEP = ["sort", "name", "room", "min", "max", "stars", "free", "cursor"];

// "Book room" opens guest details (screen 10) with the rate and the chosen bed type only; the
// price and the price-check token stay on the server. The bed choice sits in another cell, so
// its radios belong to the row's form through the `form` attribute.
function RateRow({ offer, stay, snapshotId }: { offer: Offer; stay: string; snapshotId: string }) {
  const cancel = cancellationLabel(offer);
  const formId = `book-${offer.roomId}-${offer.rateId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="text-[15px] font-bold text-ink">{offer.roomName}</p>
        {offer.bedGroups.length > 1 ? (
          <fieldset className="mt-2">
            <legend className="text-xs font-semibold text-[#37413d]">Bed type</legend>
            {offer.bedGroups.map((bed, i) => (
              <label key={bed.id} className="mt-1 flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" form={formId} name="b" value={bed.id} defaultChecked={i === 0} />
                {bed.description}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="mt-1 text-[13px] text-[#37413d]">{offer.bedGroups[0]?.description}</p>
        )}
        <p className="mt-1.5 text-xs text-muted">Bed type is a request and not guaranteed.</p>
      </td>
      <td className="px-4 py-4">
        <p className={`text-[13.5px] font-bold ${cancel.refundable ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{cancel.text}</p>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-semibold text-brand">Cancellation policy</summary>
          <div className="mt-1.5">
            <CancellationPolicy refundable={offer.refundable} penalties={offer.cancelPenalties} nonrefundableDateRanges={offer.nonrefundableDateRanges} />
          </div>
        </details>
      </td>
      <td className="px-4 py-4">
        <PriceDetails price={offer.price} stay={stay} />
      </td>
      <td className="px-4 py-4">
        <form id={formId} method="get" action="/book/new">
          <input type="hidden" name="s" value={snapshotId} />
          <input type="hidden" name="p" value={offer.propertyId} />
          <input type="hidden" name="r" value={offer.rateId} />
          {offer.bedGroups.length === 1 ? <input type="hidden" name="b" value={offer.bedGroups[0]!.id} /> : null}
          <button type="submit" className={`${btnPrimary} w-full`}>
            Book room
          </button>
        </form>
      </td>
    </tr>
  );
}

// Screen 09: one hotel of a search, with every rate the supplier returned and what Expedia
// requires on this page (AP1, AP2, AP3, BP3, BP4, BP5). The rates come from the search's
// stored snapshot, scoped to the agency; the price is checked again before booking (plan 3).
export default async function HotelPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id, propertyId } = await params;
  const query = await searchParams;
  const now = new Date();
  const summary = await searchSummary(agencyId, id, now);
  if (!summary) notFound();

  const back = new URLSearchParams();
  for (const key of KEEP) for (const v of [query[key] ?? []].flat()) if (v) back.append(key, v.slice(0, 100));
  const backHref = `/search/${id}${back.toString() ? `?${back}` : ""}`;

  let data;
  try {
    data = await getHotelOffers(agencyId, id, propertyId, now);
  } catch (error) {
    if (!(error instanceof SearchRateLimited)) throw error;
    return (
      <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-8">
        <p role="alert" className={alertError}>
          {error.message}
        </p>
      </main>
    );
  }
  if (!data) {
    if (summary.expired) {
      return (
        <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-8">
          <p role="alert" className={alertError}>
            These prices expired (they are kept for 30 minutes). <Link href="/search" className={link}>Search again</Link>
          </p>
        </main>
      );
    }
    notFound();
  }

  const { offers, content, hotel } = data;
  const name = content?.name ?? hotel.name;
  const stay = stayText(summary);
  const address = content ? [content.address.line1, content.address.city, content.address.countryCode].filter(Boolean).join(", ") : hotel.city;
  const sorted = [...offers].sort((a, b) => a.price.total.minor - b.price.total.minor);

  return (
    <main className="mx-auto flex w-[min(1260px,calc(100%-40px))] flex-col gap-6 py-6">
      <Link href={backHref} className={link}>
        ← Back to hotels
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <HotelPhoto url={content?.heroImage?.url} alt={name} className="h-28 w-full rounded-[14px] sm:w-44" />
        <div>
          <h1 className="flex flex-wrap items-center gap-3 font-serif text-[34px] leading-tight text-ink">
            {name} <Stars rating={content?.starRating ?? hotel.starRating} />
          </h1>
          <p className="text-[13px] text-muted">{address}</p>
          <p className="mt-1 text-[13px] text-[#37413d]">
            {shortDate(summary.checkin)} to {shortDate(summary.checkout)} · {stay}
          </p>
        </div>
      </header>

      <section aria-labelledby="rooms-title">
        <h2 id="rooms-title" className={sectionTitle}>
          Room options <span className="text-sm font-normal text-muted">{offers.length} {offers.length === 1 ? "rate" : "rates"}</span>
        </h2>
        <div className="mt-3 overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_14px_36px_rgba(19,47,39,0.08)]">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-brand text-paper">
              <tr>
                <th className="px-4 py-3 font-semibold">Room</th>
                <th className="px-4 py-3 font-semibold">Cancellation</th>
                <th className="px-4 py-3 font-semibold">Price · {stay}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Book</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0ece4]">
              {sorted.map((offer) => (
                <RateRow key={`${offer.roomId}-${offer.rateId}`} offer={offer} stay={stay} snapshotId={id} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {content ? (
        <>
          <Policies content={content} />
          <div className="grid gap-5 md:grid-cols-2">
            {content.description ? (
              <section aria-labelledby="about-title" className={`${card} bg-white p-5`}>
                <h2 id="about-title" className={sectionTitle}>
                  About the hotel
                </h2>
                <div className="mt-3">
                  <SupplierText html={content.description} />
                </div>
              </section>
            ) : null}
            {content.amenities.length > 0 ? (
              <section aria-labelledby="amenities-title" className={`${card} bg-white p-5`}>
                <h2 id="amenities-title" className={sectionTitle}>
                  Amenities
                </h2>
                <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[13px] text-[#37413d]">
                  {content.amenities.slice(0, 40).map((a) => (
                    <li key={a}>✓ {a}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          {content.images.length > 1 ? (
            <section aria-labelledby="photos-title" className={`${card} bg-white p-5`}>
              <h2 id="photos-title" className={sectionTitle}>
                Hotel photos
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {content.images.slice(0, 12).map((image, i) => (
                  <HotelPhoto key={i} url={image.url} alt={image.caption ?? name} className="h-36 w-full rounded-[10px]" />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">Hotel details are not available right now. The rates above are current.</p>
      )}
      <p className="text-xs text-muted">Check-in and cancellation times are the hotel&apos;s local time.</p>
    </main>
  );
}

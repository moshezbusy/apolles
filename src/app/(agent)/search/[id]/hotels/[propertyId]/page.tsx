import type { Metadata } from "next";
import { RateIncludes } from "@/components/RateIncludes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, btnPrimary, card, cellTop, cellWide, link, sectionTitle, tbody, tr } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { SearchRateLimited } from "@/server/search/errors";
import { getHotelOffers, searchSummary } from "@/server/search/search";
import type { Offer } from "@/server/supplier/types";
import { HotelPhoto, Stars, shortDate, stayText } from "../../../parts";
import { CancellationPolicy, Policies, PriceDetails, SupplierText } from "../../../../_components/hotel-info";
import { cancellationLabel } from "../../../../_components/rate-text";
import { addToQuoteAction } from "../../../../quotes/actions";
import { AddToQuote } from "../../../../quotes/add-to-quote";
import { freeCancelEnds } from "@/server/booking/service";
import { openQuotes, quoteCode } from "@/server/quotes/quotes";
import { quoteParam } from "../../../quote-param";

type QuoteChoice = { id: string; label: string };

export const metadata: Metadata = { title: "Hotel | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string; propertyId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEEP = ["sort", "name", "room", "min", "max", "stars", "free", "cursor", "quote"];

// "Book room" opens guest details (screen 10) with the rate and the chosen bed type only; the
// price and the price-check token stay on the server. The bed choice sits in another cell, so
// its radios belong to the row's form through the `form` attribute.
function RateRow({
  offer,
  stay,
  snapshotId,
  quotes,
  quoteId,
}: {
  offer: Offer;
  stay: string;
  snapshotId: string;
  quotes: QuoteChoice[];
  quoteId: string | null;
}) {
  const cancel = cancellationLabel(offer);
  const formId = `book-${offer.roomId}-${offer.rateId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <tr className={`${tr} align-top`}>
      <td data-label="" className={cellTop}>
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
        <RateIncludes amenities={offer.amenities} className="mt-1.5 text-[13px] text-[#37413d]" />
      </td>
      <td data-label="Cancellation" className={cellTop}>
        <p className={`text-[13.5px] font-bold ${cancel.refundable ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{cancel.text}</p>
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-semibold text-brand">Cancellation policy</summary>
          <div className="mt-1.5">
            <CancellationPolicy refundable={offer.refundable} penalties={offer.cancelPenalties} nonrefundableDateRanges={offer.nonrefundableDateRanges} />
          </div>
        </details>
      </td>
      <td data-label="Price" className={cellTop}>
        <PriceDetails price={offer.price} stay={stay} />
      </td>
      <td data-label="" className={`${cellTop} ${cellWide}`}>
        <form id={formId} method="get" action="/book/new">
          <input type="hidden" name="s" value={snapshotId} />
          <input type="hidden" name="p" value={offer.propertyId} />
          <input type="hidden" name="r" value={offer.rateId} />
          {offer.bedGroups.length === 1 ? <input type="hidden" name="b" value={offer.bedGroups[0]!.id} /> : null}
          <button type="submit" className={`${btnPrimary} w-full`}>
            Book room
          </button>
        </form>
        <AddToQuote formId={formId} quotes={quotes} defaultQuoteId={quoteId} action={addToQuoteAction} />
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
  // Room filters (screen 09): room name, free cancellation only, price order. Names differ from
  // the results filters (kept for "Back to hotels").
  const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").slice(0, 60);
  const roomText = one(query.rq).trim().toLowerCase();
  const freeOnly = one(query.rf) === "1";
  const desc = one(query.rs) === "price_desc";
  const sorted = offers
    .filter((o) => !roomText || `${o.roomName} ${o.bedGroups.map((b) => b.description).join(" ")}`.toLowerCase().includes(roomText))
    // Free cancellation still ahead (the same rule as the booking's deadline), never one already over.
    .filter((o) => {
      if (!freeOnly) return true;
      const end = freeCancelEnds(o);
      return end !== null && end > now;
    })
    .sort((a, b) => (desc ? b.price.total.minor - a.price.total.minor : a.price.total.minor - b.price.total.minor));
  const filtered = roomText !== "" || freeOnly;
  // Plan 5b: "Add to quote" lists the agency's open quotes; one opened from a quote is preselected.
  const quoteId = quoteParam(query.quote);
  const quotes = (await openQuotes(agencyId, quoteId)).map((q) => ({ id: q.id, label: `${quoteCode(q.number)} · ${q.title || "Untitled quote"}` }));

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
          Room options <span className="text-sm font-normal text-muted">{filtered ? `${sorted.length} of ${offers.length}` : offers.length} {offers.length === 1 ? "rate" : "rates"}</span>
        </h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3 text-[13px]">
          {[...back.entries()].map(([k, v], i) => (
            <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
          ))}
          <label className="flex flex-col gap-1 font-semibold text-[#37413d]">
            Room name
            <input type="search" name="rq" defaultValue={one(query.rq)} maxLength={60} placeholder="e.g. Ocean view, King" className="rounded-[10px] border border-line bg-white px-3 py-2 font-normal" />
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" name="rf" value="1" defaultChecked={freeOnly} className="h-4 w-4 accent-brand" />
            Free cancellation only
          </label>
          <label className="flex flex-col gap-1 font-semibold text-[#37413d]">
            Sort
            <select name="rs" defaultValue={desc ? "price_desc" : "price_asc"} className="rounded-[10px] border border-line bg-white px-3 py-2 font-normal">
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>
          <button type="submit" className="rounded-[10px] border border-line bg-white px-4 py-2 font-semibold text-ink hover:border-brand">
            Apply
          </button>
          {filtered ? (
            <Link href={`/search/${id}/hotels/${propertyId}${back.toString() ? `?${back}` : ""}`} className={link}>
              Clear filters
            </Link>
          ) : null}
        </form>
        {sorted.length === 0 ? <p className="mt-3 text-sm text-muted">No room matches these filters. Clear the filters to see all rooms.</p> : null}
        <div className="mt-3 overflow-x-auto rounded-[18px] border border-line bg-white shadow-[0_14px_36px_rgba(19,47,39,0.08)]">
          <table className="w-full text-left text-sm max-md:block md:min-w-[820px]">
            <thead className="bg-brand text-paper max-md:hidden">
              <tr>
                <th className="px-4 py-3 font-semibold">Room</th>
                <th className="px-4 py-3 font-semibold">Cancellation</th>
                <th className="px-4 py-3 font-semibold">Price · {stay}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Book</span>
                </th>
              </tr>
            </thead>
            <tbody className={tbody}>
              {sorted.map((offer) => (
                <RateRow key={`${offer.roomId}-${offer.rateId}`} offer={offer} stay={stay} snapshotId={id} quotes={quotes} quoteId={quoteId} />
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

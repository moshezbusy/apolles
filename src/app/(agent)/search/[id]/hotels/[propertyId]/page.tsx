import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertError, btnPrimary, card, link, sectionTitle } from "@/components/ui";
import { toBlocks } from "@/lib/supplier-text";
import { requireAgent } from "@/server/auth/guards";
import { SearchRateLimited } from "@/server/search/errors";
import { getHotelOffers, searchSummary } from "@/server/search/search";
import type { Offer, PropertyContent } from "@/server/supplier/types";
import { HotelPhoto, Stars, shortDate, stayText } from "../../../parts";
import { DUE_LABEL, LINE_LABEL, cancellationLabel, money, penaltyText } from "./rate-text";

export const metadata: Metadata = { title: "Hotel | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string; propertyId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KEEP = ["sort", "name", "room", "min", "max", "stars", "free", "cursor"];

// Supplier text, shown as plain paragraphs and list items (never as HTML).
function SupplierText({ html }: { html: string | null | undefined }) {
  const blocks = toBlocks(html);
  if (blocks.length === 0) return null;
  const items = blocks.filter((b) => b.kind === "li");
  return (
    <div className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-[#37413d]">
      {blocks
        .filter((b) => b.kind === "p")
        .map((b, i) => (
          <p key={`p${i}`}>{b.text}</p>
        ))}
      {items.length > 0 ? (
        <ul className="list-disc pl-5">
          {items.map((b, i) => (
            <li key={`li${i}`}>{b.text}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Policies({ content }: { content: PropertyContent }) {
  const { checkin, checkout, fees } = content;
  const checkinTime = [checkin.beginTime, checkin.endTime].filter(Boolean).join(" to ");
  return (
    <section id="policies" aria-labelledby="policies-title" className={`${card} bg-white p-5`}>
      <h2 id="policies-title" className={sectionTitle}>
        Policies
      </h2>
      <dl className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <dt className="text-sm font-bold text-ink">Check-in</dt>
          <dd className="mt-1 flex flex-col gap-1.5 text-[13.5px] text-[#37413d]">
            {checkinTime ? <p>From {checkinTime}</p> : null}
            {checkin.minAge ? <p>Minimum check-in age: {checkin.minAge}</p> : null}
            <SupplierText html={checkin.instructions} />
          </dd>
        </div>
        <div>
          <dt className="text-sm font-bold text-ink">Check-out</dt>
          <dd className="mt-1 text-[13.5px] text-[#37413d]">{checkout.time ? `By ${checkout.time}` : "See the hotel's instructions"}</dd>
        </div>
        {checkin.specialInstructions ? (
          <div>
            <dt className="text-sm font-bold text-ink">Special instructions</dt>
            <dd className="mt-1">
              <SupplierText html={checkin.specialInstructions} />
            </dd>
          </div>
        ) : null}
        {fees.mandatory || fees.optional ? (
          <div>
            <dt className="text-sm font-bold text-ink">Fees</dt>
            <dd className="mt-1 flex flex-col gap-2">
              <SupplierText html={fees.mandatory} />
              <SupplierText html={fees.optional} />
            </dd>
          </div>
        ) : null}
        {content.knowBeforeYouGo ? (
          <div className="md:col-span-2">
            <dt className="text-sm font-bold text-ink">Know before you go</dt>
            <dd className="mt-1">
              <SupplierText html={content.knowBeforeYouGo} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function RateRow({ offer, stay }: { offer: Offer; stay: string }) {
  const cancel = cancellationLabel(offer);
  const { price } = offer;
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="text-[15px] font-bold text-ink">{offer.roomName}</p>
        {offer.bedGroups.length > 1 ? (
          <fieldset className="mt-2">
            <legend className="text-xs font-semibold text-[#37413d]">Bed type</legend>
            {offer.bedGroups.map((bed, i) => (
              <label key={bed.id} className="mt-1 flex items-center gap-2 text-[13px] text-ink">
                <input type="radio" name={`bed-${offer.rateId}`} value={bed.id} defaultChecked={i === 0} />
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
          <ul className="mt-1.5 flex flex-col gap-1 text-xs text-[#37413d]">
            {offer.cancelPenalties.map((p, i) => (
              <li key={i}>{penaltyText(p)}</li>
            ))}
            {offer.nonrefundableDateRanges.map((r, i) => (
              <li key={`n${i}`}>
                Non-refundable for stay dates {r.start} to {r.end}.
              </li>
            ))}
            {!offer.refundable ? <li>This rate cannot be cancelled or changed without paying the full amount.</li> : null}
            {offer.refundable && offer.cancelPenalties.length === 0 ? <li>Free cancellation before check-in.</li> : null}
          </ul>
        </details>
      </td>
      <td className="px-4 py-4">
        <p className="text-[20px] font-extrabold tabular-nums text-ink">{money(price.total)}</p>
        <p className="text-xs text-muted">Total for {stay}</p>
        <dl className="mt-2 flex flex-col gap-0.5 text-xs text-[#37413d]">
          {price.lines.map((line) => (
            <div key={line.kind} className="flex justify-between gap-3">
              <dt>{LINE_LABEL[line.kind]}</dt>
              <dd className="tabular-nums">{money(line.amount)}</dd>
            </div>
          ))}
        </dl>
        {price.dueAtProperty.length > 0 ? (
          <div className="mt-2.5 rounded-[9px] border border-[#eadfbe] bg-[#fff9e9] p-2 text-xs text-[#6f5a20]">
            <p className="font-bold">Paid at the property, not included in the total</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {price.dueAtProperty.map((fee, i) => (
                <li key={i}>
                  {DUE_LABEL[fee.kind]}: {fee.localAmount ? `${money(fee.localAmount)} (about ${money(fee.amount)})` : money(fee.amount)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </td>
      <td className="px-4 py-4">
        <button type="button" disabled className={`${btnPrimary} w-full`} title="Booking opens soon">
          Book room
        </button>
        <p className="mt-1.5 text-center text-[11px] text-muted">Booking opens soon</p>
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
                <RateRow key={`${offer.roomId}-${offer.rateId}`} offer={offer} stay={stay} />
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

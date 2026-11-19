import type { Metadata } from "next";
import { RateIncludes } from "@/components/RateIncludes";
import Link from "next/link";
import { alertInfo, card, link, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { clientOptions } from "@/server/clients";
import { bookingPrefill } from "@/server/quotes/quote-booking";
import { findOffer } from "@/server/search/search";
import { PriceDetails } from "../../_components/hotel-info";
import { cancellationLabel } from "../../_components/rate-text";
import { shortDate, stayText } from "../../search/parts";
import { createDraftAction } from "../actions";
import { Steps } from "../../_components/steps";
import { roomTitle } from "../../_components/guests";
import { ClientChooser, GuestForm, type GuestFormRoom } from "./guest-form";

export const metadata: Metadata = { title: "Guest details | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.slice(0, 128) ?? "";
}

// Screen 10: guest details for one rate of the agency's own search. From a quote (?stay=) the
// quote's client fills the guests; "Choose from clients" (?client=) fills them from another client.
export default async function GuestDetailsPage({ searchParams }: { searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const q = await searchParams;
  const rate = { s: one(q.s), p: one(q.p), r: one(q.r), b: one(q.b) };
  const found = await findOffer(agencyId, { snapshotId: rate.s, propertyId: rate.p, rateId: rate.r, bedGroupId: rate.b });
  if (!found) {
    return (
      <main className="mx-auto w-[min(900px,calc(100%-40px))] py-10">
        <h1 className={pageTitle}>Guest details</h1>
        <p role="alert" className={`${alertInfo} mt-5`}>
          These prices expired (they are kept for 30 minutes). <Link href="/search" className={link}>Search again</Link>
        </p>
      </main>
    );
  }
  const { offer, bedGroup, hotel, query } = found;
  const stayId = /^[a-z0-9]{20,40}$/.test(one(q.stay)) ? one(q.stay) : "";
  const chosen = one(q.client);
  const [prefill, clients] = await Promise.all([
    // "none": the agent chose "New guest", so nothing is filled (not even the quote's client).
    chosen === "none" ? Promise.resolve(null) : bookingPrefill(agencyId, chosen ? { clientId: chosen } : stayId ? { stayId } : {}),
    clientOptions(agencyId),
  ]);
  const stay = stayText({ nights: offer.price.nights, rooms: found.rooms });
  // A section per room when there are several (plan 10); one room looks as it always did.
  const rooms: GuestFormRoom[] = found.rooms.map((room, r) => ({
    heading: found.rooms.length > 1 ? roomTitle(r, room) : null,
    guests: [...Array.from({ length: room.adults }, (_, i) => `Adult ${i + 1}`), ...room.childAges.map((age, i) => `Child ${i + 1} (age ${age})`)],
  }));
  return (
    <main className="mx-auto grid w-[min(1100px,calc(100%-40px))] gap-6 py-8 lg:grid-cols-[1fr_320px]">
      <section className={`${card} bg-white p-6`}>
        <Steps current={3} />
        <h1 className={pageTitle}>Guest details</h1>
        <p className="mb-5 mt-1 text-sm text-muted">Enter the traveler names exactly as they appear on their travel documents.</p>
        {clients.length > 0 ? <ClientChooser clients={clients} selected={prefill?.clientId ?? ""} /> : null}
        <GuestForm action={createDraftAction} rate={{ ...rate, ...(stayId ? { stay: stayId } : {}) }} rooms={rooms} prefill={prefill} />
      </section>
      <aside className={`${card} h-fit bg-white p-5`}>
        <h2 className="font-serif text-[22px] text-ink">{hotel.name}</h2>
        <p className="text-[13px] text-muted">{hotel.city}</p>
        <p className="mt-3 text-sm font-bold text-ink">{offer.roomName}</p>
        <p className="text-[13px] text-[#37413d]">{bedGroup.description}</p>
        <p className="text-xs text-muted">Bed type is a request and not guaranteed.</p>
        <RateIncludes amenities={offer.amenities} className="mt-1 text-[13px] text-[#37413d]" />
        <p className="mt-2 text-[13px] text-[#37413d]">
          {shortDate(query.checkin)} to {shortDate(query.checkout)} · {stay}
        </p>
        <p className={`mt-2 text-[13px] font-bold ${offer.refundable ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{cancellationLabel(offer).text}</p>
        <div className="mt-3 border-t border-line pt-3">
          <PriceDetails price={offer.price} stay={stay} />
          <p className="mt-2 text-xs text-muted">The price is checked again on the next page.</p>
        </div>
      </aside>
    </main>
  );
}


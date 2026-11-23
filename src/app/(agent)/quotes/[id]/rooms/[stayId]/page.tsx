import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RateIncludes } from "@/components/RateIncludes";
import { alertInfo, btnPrimary, card, link, pageTitle } from "@/components/ui";
import { formatMinor } from "@/lib/supplier-money";
import { requireAgent } from "@/server/auth/guards";
import { ROOM_GONE, otherRooms } from "@/server/quotes/quote-booking";
import { quoteCode } from "@/server/quotes/quotes";
import { cancellationLabel } from "../../../../_components/rate-text";
import { shortDate } from "../../../../search/parts";

export const metadata: Metadata = { title: "Choose another room | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string; stayId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// After "Book this room" found that the room the client picked is gone: the rooms the same hotel
// has now for the same dates and guests (the agency's own fresh search). The destination and the
// client's pick stay as they are; "Book this room" here goes on to guest details and the review
// page, where the new price and terms are set against what the client was quoted.
export default async function OtherRoomsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id, stayId } = await params;
  const s = (await searchParams).s;
  const snapshotId = (Array.isArray(s) ? s[0] : s)?.slice(0, 64) ?? "";
  const found = await otherRooms(agencyId, id, stayId, snapshotId);
  // Another agency's quote, a booked destination, or prices older than 30 minutes.
  if (!found) notFound();
  return (
    <main className="mx-auto flex w-[min(900px,calc(100%-40px))] flex-col gap-5 pb-16 pt-6">
      <Link href={`/quotes/${found.quoteId}#selections`} className={link}>
        ← Back to {quoteCode(found.number)}
      </Link>
      <h1 className={pageTitle}>Choose another room</h1>
      <p role="alert" className={alertInfo}>
        {ROOM_GONE} The client chose {found.picked.roomName} ({found.picked.bedDescription}) at {found.hotelName}, quoted at {formatMinor(found.picked.quotedMinor, found.picked.currency)}. These are the rooms the hotel
        has now for {shortDate(found.checkin)} to {shortDate(found.checkout)}. Agree the change with the client before you book.
      </p>
      <ul className="flex flex-col gap-3">
        {found.offers.flatMap((offer) =>
          offer.bedGroups.map((bed) => {
            const cancel = cancellationLabel(offer);
            const query = new URLSearchParams({ s: snapshotId, p: found.propertyId, r: offer.rateId, b: bed.id, stay: found.stayId });
            return (
              <li key={`${offer.rateId}-${bed.id}`} className={`${card} flex flex-wrap items-center justify-between gap-3 bg-white p-4`}>
                <div className="min-w-[220px] flex-1">
                  <p className="text-[15px] font-bold text-ink">{offer.roomName}</p>
                  <p className="text-[13px] text-[#37413d]">{bed.description}</p>
                  <RateIncludes amenities={offer.amenities} className="text-[13px] text-[#37413d]" />
                  <p className={`text-[13px] font-bold ${cancel.refundable ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>{cancel.text}</p>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-ink">{formatMinor(offer.price.total.minor, offer.price.total.currency)}</p>
                  <p className="text-xs text-muted">net, checked again before booking</p>
                </div>
                <Link href={`/book/new?${query.toString()}`} className={btnPrimary}>
                  Book this room
                </Link>
              </li>
            );
          }),
        )}
      </ul>
    </main>
  );
}

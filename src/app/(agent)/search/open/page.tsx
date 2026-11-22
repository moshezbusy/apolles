import type { Metadata } from "next";
import Link from "next/link";
import { alertError, alertInfo, btnPrimary, card, link, pageTitle } from "@/components/ui";
import { formatDmy, nightsBetween } from "@/components/date-picker/calendar";
import { requireAgent } from "@/server/auth/guards";
import { openLinkHotel } from "@/server/search/open-link";
import { Stars, stayText } from "../parts";
import { showRatesAction } from "./actions";
import { NOTICES, displayText, noticeOf, parseOpenFields } from "./query";

export const metadata: Metadata = { title: "Open hotel | Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Problem({ message }: { message: string }) {
  return (
    <main className="mx-auto w-[min(640px,calc(100%-40px))] py-10">
      <h1 className={pageTitle}>Hotel search</h1>
      <p className={`${alertError} mt-4`} role="alert">
        {message}
      </p>
      <p className="mt-4">
        <Link href="/search" className={link}>
          Go to hotel search
        </Link>
      </p>
    </main>
  );
}

// Where "View in Apolles" from an assistant lands (design §6). Opening it searches nothing and
// writes nothing: it shows what the link says, with the hotel's name read from our own data, and
// "Show rates" (a server action) runs the search. Prices are always fetched fresh there.
export default async function OpenResultPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // After sign-in (and the email code) the agent comes back to this very link.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v !== undefined) query.set(key, v);
  }
  await requireAgent({ returnTo: `/search/open?${query.toString()}` });

  const fields = parseOpenFields(params);
  if (!fields) return <Problem message={NOTICES.invalid} />;
  const hotel = await openLinkHotel(fields.hotel);
  if (!hotel) return <Problem message="This hotel can no longer be booked. Choose another hotel." />;

  const notice = noticeOf(params.notice);
  const nationality = displayText(params.nat, 100);
  const nights = nightsBetween(fields.checkin, fields.checkout) ?? 0;

  return (
    <main className="mx-auto w-[min(640px,calc(100%-40px))] py-10">
      <h1 className={pageTitle}>Hotel search</h1>
      {notice ? (
        <p className={`${alertError} mt-4`} role="alert">
          {NOTICES[notice]}
        </p>
      ) : null}
      <section className={`${card} mt-6 p-5`}>
        <h2 className="text-lg font-bold text-ink">{hotel.name}</h2>
        <p className="mt-1 text-sm text-muted">
          {hotel.city} <Stars rating={hotel.starRating} />
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Dates</dt>
          <dd className="text-ink">
            {formatDmy(fields.checkin)} to {formatDmy(fields.checkout)}
          </dd>
          <dt className="text-muted">Stay</dt>
          <dd className="text-ink">{stayText({ nights, rooms: fields.rooms })}</dd>
          {nationality ? (
            <>
              <dt className="text-muted">Nationality</dt>
              <dd className="text-ink">{nationality}</dd>
            </>
          ) : null}
        </dl>
        <p className={`${alertInfo} mt-4`}>Prices are checked again now. They may differ from what the assistant showed.</p>
        <form action={showRatesAction} className="mt-5">
          <input type="hidden" name="hotel" value={fields.hotel} />
          <input type="hidden" name="destId" value={fields.destId} />
          <input type="hidden" name="in" value={fields.checkin} />
          <input type="hidden" name="out" value={fields.checkout} />
          <input type="hidden" name="rooms" value={fields.roomsText} />
          <button type="submit" className={btnPrimary}>
            Show rates
          </button>
        </form>
      </section>
    </main>
  );
}

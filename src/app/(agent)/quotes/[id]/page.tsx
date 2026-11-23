import type { Metadata } from "next";
import { DateField } from "@/components/date-picker/DateField";
import { DateRangeField } from "@/components/date-picker/DateRangeField";
import { RateIncludes } from "@/components/RateIncludes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertInfo, alertSuccess, btnPrimary, btnSecondary, card, input, inputUnsized, label, link } from "@/components/ui";
import { PHONE_NEEDS_COUNTRY_CODE, toE164Digits } from "@/lib/phone";
import { formatMinor } from "@/lib/supplier-money";
import { requireAgent } from "@/server/auth/guards";
import { clientOptions } from "@/server/clients";
import { addDays, clientCancelView, dayAhead, defaultClientDate, offerLastDay, sellingMinor, supplierCancelView, todayIso } from "@/server/quotes/pricing";
import { getQuote, markSelectionSeen, newsOf, preSendChecks, quoteCode, quoteExpired, quoteNumbers, type QuoteDetail } from "@/server/quotes/quotes";
import type { PriceBreakdown } from "@/server/supplier/types";
import { dateRange } from "../../search/dates";
import { DestinationPicker } from "../../search/destination-picker";
import { Stars, shortDate } from "../../search/parts";
import { ActionForm } from "../action-form";
import {
  addStayAction,
  bookFromQuoteAction,
  clearSelectionAction,
  closeQuoteAction,
  copyLinkAction,
  emailAction,
  emailPreviewAction,
  extendOfferAction,
  hotelAction,
  refreshPricesAction,
  removeRoomAction,
  removeStayAction,
  renewLinkAction,
  reopenQuoteAction,
  roomDateAction,
  roomPriceAction,
  saveSettingsAction,
  selectForClientAction,
  whatsappAction,
} from "../actions";
import { type StayBooking, stayBookings } from "@/server/quotes/quote-booking";
import { shareUrl } from "@/server/quotes/sharing";
import { QuoteDirtyProvider } from "./dirty";
import { SendPanel } from "./send-panel";
import { NewsBadge, QuotePill, guestsText } from "../parts";
import { PendingButton } from "../pending-button";

export const metadata: Metadata = { title: "Quote | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const sectionHead = "text-base font-bold text-ink";
const sectionSub = "text-xs text-muted";
const iconBtn =
  "grid h-8 w-8 place-items-center rounded-lg border border-[#d9e1dc] bg-white text-[13px] text-[#4d5a54] hover:border-[#bcd0c6] hover:text-brand disabled:opacity-40";

function nights(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

const dayMonth = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function money(minor: number | null, currency = "USD"): string {
  return minor === null ? "" : formatMinor(minor, currency);
}

// Screen 15: one quote of the agency. The client, settings and markup are one form ("Save
// changes"); each destination, hotel and room option has its own small forms. Preview and
// sending to the client come with plan 5c; booking a room from the quote with plan 5d.
export default async function QuoteEditorPage({ params, searchParams }: { params: Params; searchParams?: SearchParams }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [quote, bookings] = await Promise.all([getQuote(agencyId, id), stayBookings(agencyId, id)]);
  if (!quote) notFound();
  // The agent opened the quote: the list's "New selection" badge goes (it still shows here once).
  const news = newsOf(quote);
  if (quote.selectionUnseen) await markSelectionSeen(agencyId, quote.id);
  const options = await clientOptions(agencyId);
  // The quote's own client is always in the list, so "Save changes" never drops it silently.
  const clients = quote.client && !options.some((c) => c.id === quote.client?.id) ? [quote.client, ...options] : options;
  // Back from "+ Add a new client": the new client is chosen in the form, to be saved.
  const newClient = one(query.client).slice(0, 64);
  const preselect = newClient && newClient !== quote.client?.id && clients.some((c) => c.id === newClient) ? newClient : null;
  const duplicated = one(query.notice) === "duplicated";
  const totals = quoteNumbers(quote);
  const roomCount = totals.options;
  const now = new Date();
  const { minDate, maxDate } = dateRange(now);
  const closed = quote.closedAt !== null;
  const expired = quoteExpired(quote, now);
  const partlyBooked = quote.status !== "BOOKED" && [...bookings.values()].some((b) => b.status === "CONFIRMED");
  // The WhatsApp button needs the client's number in its international form.
  const phoneHint = quote.client && !toE164Digits(quote.client.phone, quote.agency.country) ? PHONE_NEEDS_COUNTRY_CODE : null;

  return (
    // The provider lets "Send quote" know while the settings form holds unsaved changes.
    <QuoteDirtyProvider initialDirty={!!preselect}>
    <main className="mx-auto flex w-[min(1100px,calc(100%-40px))] flex-col gap-5 pb-16 pt-6">
      <Link href="/quotes" className={link}>
        ← Back to quotes
      </Link>
      {duplicated ? (
        <p role="status" className={alertSuccess}>
          Quote duplicated as {quoteCode(quote.number)}. Choose the client, and refresh the prices of each destination before you send it.
        </p>
      ) : null}
      {preselect ? (
        <p role="status" className={alertInfo}>
          New client added and chosen below. Choose Save changes to keep it on this quote.
        </p>
      ) : null}

      <ActionForm action={saveSettingsAction} className="flex flex-col gap-5" keepValues trackDirty>
        <input type="hidden" name="quoteId" value={quote.id} />
        <section className={`${card} flex flex-wrap items-start justify-between gap-4 bg-white p-5`}>
          <div className="min-w-[260px] flex-1">
            <label className="sr-only" htmlFor="quote-title">
              Quote name
            </label>
            <input
              id="quote-title"
              type="text"
              name="title"
              maxLength={80}
              defaultValue={quote.title}
              placeholder="Untitled quote"
              className={`${inputUnsized} font-serif text-[22px]`}
            />
            <p className="mt-2 text-[13px] text-muted">
              {quote.client ? `${quote.client.firstName} ${quote.client.lastName} · ` : ""}
              {quoteCode(quote.number)}
              {quote.sentAt ? ` · Sent ${dayMonth.format(quote.sentAt)}` : ""}
              {quote.viewCount ? ` · Viewed ${quote.viewCount} ${quote.viewCount === 1 ? "time" : "times"}` : ""} ·{" "}
              <strong className="text-ink">1 room · {guestsText(quote.adults, quote.childAges)}</strong>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <NewsBadge news={news} />
            <QuotePill status={quote.status} closed={closed} expired={expired} partlyBooked={partlyBooked} />
            <PendingButton className={btnPrimary} pendingText="Saving…">
              Save changes
            </PendingButton>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className={`${card} flex flex-col gap-3 bg-white p-5`}>
            <div>
              <h2 className={sectionHead}>Client</h2>
              <p className={sectionSub}>Who receives this quote</p>
            </div>
            <label className={label}>
              Client
              <select name="clientId" defaultValue={preselect ?? quote.client?.id ?? ""} className={input}>
                <option value="">No client yet</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </label>
            {quote.client ? (
              <dl className="grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <dt className="text-xs font-semibold text-[#37413d]">Email</dt>
                  <dd className="break-all text-ink">{quote.client.email ?? "None"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-[#37413d]">WhatsApp phone</dt>
                  <dd className="text-ink">{quote.client.phone}</dd>
                </div>
              </dl>
            ) : null}
            {phoneHint ? (
              <p role="note" className="text-xs font-semibold text-[#8a6a10]">
                {phoneHint}{" "}
                <Link href={`/clients?id=${quote.client?.id ?? ""}&edit=1`} className="underline">
                  Open the client
                </Link>
              </p>
            ) : null}
            <Link href={`/quotes/${quote.id}/new-client`} className={link}>
              + Add a new client
            </Link>
          </section>

          <section className={`${card} flex flex-col gap-3 bg-white p-5`}>
            <div>
              <h2 className={sectionHead}>Quote settings</h2>
              <p className={sectionSub}>What the client sees</p>
            </div>
            <label className={label}>
              Quote language
              <select name="language" defaultValue={quote.language} className={input}>
                <option value="EN">English</option>
                <option value="HE">Hebrew</option>
              </select>
            </label>
            <label className={label}>
              Message to client
              <textarea name="message" rows={3} maxLength={1000} defaultValue={quote.message} className={input} />
            </label>
            <label className="flex items-start gap-2 rounded-lg bg-[#f6f4ef] p-3 text-[13px] text-ink">
              <input type="checkbox" name="showCancellation" defaultChecked={quote.showCancellation} className="mt-0.5" />
              <span>
                <strong>Show cancellation terms to the client</strong>
                <span className="block text-xs text-muted">Off: the client page shows no cancellation terms.</span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                Adults
                <select name="adults" defaultValue={String(quote.adults)} disabled={roomCount > 0} className={input}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Children&apos;s ages
                <input type="text" name="childAges" defaultValue={quote.childAges.join(", ")} disabled={roomCount > 0} placeholder="e.g. 7, 9" className={input} />
              </label>
            </div>
            {/* Disabled fields are not sent: send the saved guests so they stay as they are. */}
            {roomCount > 0 ? (
              <>
                <input type="hidden" name="adults" value={quote.adults} />
                <input type="hidden" name="childAges" value={quote.childAges.join(",")} />
                <p className={sectionSub}>Guests are fixed once the quote has rooms: the prices are for these guests.</p>
              </>
            ) : null}
          </section>

          <section className={`${card} flex flex-col gap-3 bg-white p-5`}>
            <div>
              <h2 className={sectionHead}>Internal pricing</h2>
              <p className={sectionSub}>Never shown to the client</p>
            </div>
            <div className="grid grid-cols-[1fr_1.4fr] gap-2">
              <label className={label}>
                Markup on this quote
                <input
                  type="text"
                  inputMode="decimal"
                  name="markupValue"
                  defaultValue={(quote.markupValue / 100).toString()}
                  className={input}
                />
              </label>
              <label className={label}>
                <span className="invisible">Type</span>
                <select name="markupType" defaultValue={quote.markupType} className={input} aria-label="Markup type">
                  <option value="PERCENT">% of net price</option>
                  <option value="FIXED">USD per room</option>
                </select>
              </label>
            </div>
            <p className={sectionSub}>Sets the selling price of every room from its net price. Rooms where you typed a price keep your price.</p>
            <dl className="grid grid-cols-3 gap-2 text-[13px]">
              <div className="rounded-lg bg-[#f6f4ef] p-2.5">
                <dt className="text-xs text-muted">Options</dt>
                <dd className="font-bold text-ink">{totals.options}</dd>
              </div>
              <div className="rounded-lg bg-[#f6f4ef] p-2.5">
                <dt className="text-xs text-muted">Lowest sell</dt>
                <dd className="font-bold text-ink">{money(totals.lowestSell)}</dd>
              </div>
              <div className="rounded-lg bg-[#f6f4ef] p-2.5">
                <dt className="text-xs text-muted">Profit range</dt>
                <dd className="font-bold text-ink">
                  {totals.profitMin === null ? "" : totals.profitMin === totals.profitMax ? money(totals.profitMin) : `${money(totals.profitMin)} to ${money(totals.profitMax)}`}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </ActionForm>

      <OfferStatus quote={quote} closed={closed} expired={expired} partlyBooked={partlyBooked} />

      <section aria-labelledby="send-title" className={`${card} bg-white p-5`}>
        <h2 id="send-title" className={sectionHead}>
          Send quote
        </h2>
        <p className={`${sectionSub} mb-3`}>Share the client link without leaving this page.</p>
        <SendPanel
          quoteId={quote.id}
          shareUrl={quote.shareToken ? shareUrl(quote.shareToken) : null}
          hasClient={!!quote.client}
          hasEmail={!!quote.client?.email}
          phoneHint={phoneHint}
          closed={closed}
          checks={preSendChecks(quote, now)}
          actions={{ copy: copyLinkAction, whatsapp: whatsappAction, email: emailAction, renew: renewLinkAction, preview: emailPreviewAction }}
        />
      </section>

      <ClientSelections quote={quote} bookings={bookings} />

      <section aria-labelledby="options-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="options-title" className="text-lg font-bold text-ink">
            Quote options
          </h2>
          <span className="text-xs text-muted">
            {quote.stays.reduce((n, s) => n + s.hotels.length, 0)} hotels · {roomCount} room options
          </span>
        </div>

        {quote.stays.map((stay) => (
          <StaySection key={stay.id} quote={quote} stay={stay} booking={bookings.get(stay.id)} locked={closed || quote.status === "BOOKED"} />
        ))}

        <section className={`${card} bg-white p-5`}>
          <h3 className={sectionHead}>+ Add destination</h3>
          <ActionForm action={addStayAction} className="mt-3 grid items-end gap-3 md:grid-cols-[1.6fr_1fr_1fr_auto]">
            <input type="hidden" name="quoteId" value={quote.id} />
            <div className={label}>
              <span>Destination</span>
              <DestinationPicker defaultId="" defaultLabel="" />
            </div>
            <DateRangeField checkin="" checkout="" min={minDate} max={maxDate} />
            <PendingButton className={btnSecondary} pendingText="Adding…">
              Add destination
            </PendingButton>
          </ActionForm>
        </section>

        <p className="text-center text-xs text-muted">Rates and availability remain subject to change until booking is confirmed.</p>
      </section>
    </main>
    </QuoteDirtyProvider>
  );
}

// Where the offer stands for the client, and the agent's buttons for it: "Extend offer" once it
// ran out, "Close quote" to finish a quote on purpose (a trip booked in part, a client who went
// quiet) and "Reopen quote" to take it up again.
function OfferStatus({ quote, closed, expired, partlyBooked }: { quote: QuoteDetail; closed: boolean; expired: boolean; partlyBooked: boolean }) {
  if (quote.status === "BOOKED") return null;
  const lastDay = quote.validUntil ? shortDate(offerLastDay(quote.validUntil)) : null;
  const text = closed
    ? "This quote is closed: the client link shows that the proposal is closed, and nothing here changes until you reopen it. Bookings made from it are not affected."
    : expired
      ? `This offer expired${lastDay ? ` (its last day was ${lastDay})` : ""}: the client can read it but can no longer choose. The prices here are the ones saved when the rooms were added. Check them, then extend the offer.`
      : lastDay
        ? `The client sees: prices valid until ${lastDay}.${partlyBooked ? " Part of this trip is booked; the other destinations are still open to the client." : ""}`
        : partlyBooked
          ? "Part of this trip is booked; the other destinations are still open."
          : "Not sent yet. The offer's validity starts when you send the quote.";
  return (
    <section aria-label="Offer status" className={`${closed || expired ? alertInfo : `${card} bg-white p-4`} flex flex-wrap items-center justify-between gap-3`}>
      <p className="min-w-[240px] flex-1 text-[13px]">{text}</p>
      <div className="flex flex-wrap items-start gap-2">
        {expired && !closed ? (
          <ActionForm action={extendOfferAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={btnPrimary} pendingText="Extending…">
              Extend offer
            </PendingButton>
          </ActionForm>
        ) : null}
        {closed ? (
          <ActionForm action={reopenQuoteAction}>
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={btnPrimary} pendingText="Reopening…">
              Reopen quote
            </PendingButton>
          </ActionForm>
        ) : (
          <ActionForm action={closeQuoteAction} confirmText="Close this quote? The client link will show that the proposal is closed. You can reopen it later.">
            <input type="hidden" name="quoteId" value={quote.id} />
            <PendingButton className={btnSecondary} pendingText="Closing…">
              Close quote
            </PendingButton>
          </ActionForm>
        )}
      </div>
    </section>
  );
}

type Stay = QuoteDetail["stays"][number];
type Hotel = Stay["hotels"][number];
type Room = Hotel["rooms"][number];

// Whose choice a picked room is: the client's (on the client page) or the agent's for the client.
function PickBadge({ byAgent }: { byAgent: boolean }) {
  return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">{byAgent ? "Your pick for the client" : "Client pick"}</span>;
}

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// `booking`: the destination's active booking. A booked destination is frozen (the server refuses
// every change to its hotels, rooms, prices and dates), so its edit controls are not drawn.
// `locked`: the quote is closed or booked (nothing changes until it is reopened).
function StaySection({ quote, stay, booking, locked }: { quote: QuoteDetail; stay: Stay; booking: StayBooking | undefined; locked: boolean }) {
  const n = nights(stay.checkin, stay.checkout);
  const frozen = !!booking;
  const today = todayIso(new Date());
  const open = !frozen && !locked && dayAhead(stay.checkin, today);
  const picked = stay.hotels.find((h) => h.rooms.some((r) => r.id === stay.selectedRoomId));
  const place = stay.destinationName.split(",")[0];
  return (
    <section className={`${card} overflow-hidden bg-white`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h3 className="text-[15px] font-bold text-ink">{stay.destinationName}</h3>
          <p className="text-xs text-muted">
            {shortDate(stay.checkin)} to {shortDate(stay.checkout)} · {n} {n === 1 ? "night" : "nights"} · {stay.hotels.length} {stay.hotels.length === 1 ? "hotel" : "hotels"}
          </p>
        </div>
        {frozen ? (
          <p className="text-xs font-semibold text-brand">
            {booking.status === "CONFIRMED" ? "Booked" : "Booking pending"} ·{" "}
            <Link href={`/bookings/${booking.id}`} className="underline">
              {booking.reference}
            </Link>
            . To change this destination, cancel the booking first.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            {open && stay.hotels.length > 0 ? (
              // One hotel search per hotel: the rooms get today's net and terms in place.
              <ActionForm action={refreshPricesAction} className="flex max-w-[420px] flex-wrap items-start gap-2">
                <input type="hidden" name="stayId" value={stay.id} />
                <PendingButton className={btnSecondary} pendingText="Refreshing…">
                  Refresh prices
                </PendingButton>
              </ActionForm>
            ) : null}
            <Link href={`/search?quote=${quote.id}&stay=${stay.id}`} className={btnSecondary}>
              + Add hotel
            </Link>
            <ActionForm
              action={removeStayAction}
              confirmText={
                picked
                  ? `Remove ${place}? The client chose ${picked.name} here: removing it also removes that selection, with every hotel and room of ${place}. This cannot be undone.`
                  : `Remove ${place} with its ${stay.hotels.length} ${stay.hotels.length === 1 ? "hotel" : "hotels"} and rooms? This cannot be undone.`
              }
            >
              <input type="hidden" name="stayId" value={stay.id} />
              <PendingButton className={`${btnSecondary} text-[#9b3b2e]`} pendingText="Removing…">
                Remove destination
              </PendingButton>
            </ActionForm>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {stay.hotels.length === 0 ? (
          <p className="text-sm text-muted">No hotels yet. &quot;+ Add hotel&quot; opens Search with these dates and guests.</p>
        ) : (
          stay.hotels.map((hotel, i) => (
            <HotelBlock key={hotel.id} quote={quote} stay={stay} hotel={hotel} nightsCount={n} first={i === 0} last={i === stay.hotels.length - 1} frozen={frozen} canPick={open} canBook={!locked} />
          ))
        )}
      </div>
    </section>
  );
}

function HotelBlock({
  quote,
  stay,
  hotel,
  nightsCount,
  first,
  last,
  frozen,
  canPick,
  canBook,
}: {
  quote: QuoteDetail;
  stay: Stay;
  hotel: Hotel;
  nightsCount: number;
  first: boolean;
  last: boolean;
  frozen: boolean;
  canPick: boolean;
  canBook: boolean;
}) {
  const sells = hotel.rooms.map((r) => sellingMinor(r, quote));
  const lowest = sells.length ? Math.min(...sells) : null;
  const holdsPick = hotel.rooms.some((r) => r.id === stay.selectedRoomId);
  const tool = (what: string, text: string, title: string, disabled = false, confirmText?: string) => (
    <ActionForm action={hotelAction} confirmText={confirmText}>
      <input type="hidden" name="hotelId" value={hotel.id} />
      <input type="hidden" name="do" value={what} />
      <PendingButton className={`${iconBtn} ${what === "pick" && hotel.agencyPick ? "border-[#e6d3a3] bg-[#fff6dc] text-[#8a6a10]" : ""}`} title={title} disabled={disabled} pendingText="…">
        {text}
      </PendingButton>
    </ActionForm>
  );
  return (
    <article className={`rounded-[12px] border ${holdsPick ? "border-brand" : hotel.agencyPick ? "border-[#e6d3a3]" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[200px] flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
            {hotel.name}
            {hotel.agencyPick ? <span className="rounded-full bg-[#fff6dc] px-2 py-0.5 text-[11px] font-bold text-[#8a6a10]">Agency pick</span> : null}
            {holdsPick ? <PickBadge byAgent={stay.selectedByAgent} /> : null}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Stars rating={hotel.starRating?.toString() ?? null} /> {hotel.city} · {hotel.rooms.length} {hotel.rooms.length === 1 ? "room option" : "room options"}
          </p>
        </div>
        {lowest !== null ? (
          <div className="text-right">
            <p className="text-[14px] font-bold text-ink">
              {hotel.rooms.length > 1 ? "From " : ""}
              {money(lowest)}
            </p>
            <p className="text-xs text-muted">{nightsCount}-night total</p>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          {tool("up", "↑", "Move up", first)}
          {tool("down", "↓", "Move down", last)}
          {tool("pick", "★", hotel.agencyPick ? "Remove agency pick" : "Mark as agency pick")}
          {frozen
            ? null
            : tool(
                "remove",
                "×",
                "Remove hotel",
                false,
                holdsPick
                  ? `Remove ${hotel.name}? It holds the room chosen for the client: removing it also clears that selection. This cannot be undone.`
                  : `Remove ${hotel.name} and its ${hotel.rooms.length} ${hotel.rooms.length === 1 ? "room" : "rooms"}? This cannot be undone.`,
              )}
        </div>
      </div>
      {hotel.rooms.map((room) => (
        <RoomBlock key={room.id} quote={quote} stay={stay} room={room} frozen={frozen} canPick={canPick} canBook={canBook} />
      ))}
    </article>
  );
}

function RoomBlock({ quote, stay, room, frozen, canPick, canBook }: { quote: QuoteDetail; stay: Stay; room: Room; frozen: boolean; canPick: boolean; canBook: boolean }) {
  const sell = sellingMinor(room, quote);
  const profit = sell - room.netMinor;
  const price = room.price as unknown as PriceBreakdown;
  const atHotel = price?.dueAtPropertyTotal ?? null;
  const today = todayIso(new Date());
  // Free cancellation as it stands today: a date that passed is never shown as free.
  const supplier = supplierCancelView(room, today);
  const client = clientCancelView(room, today);
  // The client's date: after today, and at least one day before the supplier's.
  const latestClientDay = room.freeCancelUntil ? defaultClientDate(room.freeCancelUntil) : null;
  const tomorrow = addDays(today, 1);
  const canSetDate = !frozen && supplier.kind === "free" && latestClientDay !== null && latestClientDay >= tomorrow;
  const picked = stay.selectedRoomId === room.id;
  return (
    <div className={`border-t border-line p-3 ${picked ? "bg-brand-soft/60" : "bg-[#fbfaf7]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-ink">
            {room.roomName}
            {picked ? <PickBadge byAgent={stay.selectedByAgent} /> : null}
          </p>
          <RateIncludes amenities={room.amenities} className="text-xs text-[#37413d]" />
          <p className="text-xs text-muted">
            {room.bedDescription}
            {atHotel ? ` · + ${formatMinor(atHotel.minor, atHotel.currency)} paid at the hotel` : ""}
            {" · "}
            {supplier.kind === "free" ? (
              <span className="text-[#2f7d4a]">
                Free cancellation until {shortDate(supplier.until)}
                {client.kind === "free" ? (
                  <span className="font-semibold text-[#8a6a10]"> · client sees {shortDate(client.until)}</span>
                ) : client.kind === "ended" ? (
                  <span className="font-semibold text-[#9b3b2e]"> · client sees: free cancellation ended on {shortDate(client.on)}</span>
                ) : null}
              </span>
            ) : supplier.kind === "ended" ? (
              <span className="font-semibold text-[#9b3b2e]">Free cancellation ended on {shortDate(supplier.on)}: non-refundable now</span>
            ) : (
              <span className="text-[#9b3b2e]">Non-refundable</span>
            )}
          </p>
          <PriceAge room={room} />
        </div>
        <p className="text-right text-[14px] font-bold text-ink">
          {money(sell, room.currency)}
          <span className="block text-xs font-normal text-muted">total</span>
        </p>
      </div>
      <div className="mt-3 grid items-end gap-3 md:grid-cols-[0.8fr_1.2fr_0.8fr_1.6fr_auto]">
        <div className="text-[13px]">
          <p className="text-xs font-semibold text-[#37413d]">Net</p>
          <p className="font-bold text-ink">{money(room.netMinor, room.currency)}</p>
        </div>
        {frozen ? (
          <div className="text-[13px]">
            <p className="text-xs font-semibold text-[#37413d]">Selling price</p>
            <p className="font-bold text-ink">{money(sell, room.currency)}</p>
          </div>
        ) : (
          <ActionForm action={roomPriceAction} className="flex flex-wrap items-end gap-2" keepValues>
            <input type="hidden" name="roomId" value={room.id} />
            <label className={`${label} flex-1`}>
              Selling price
              <input
                type="text"
                inputMode="decimal"
                name="price"
                defaultValue={room.sellMinor === null ? "" : (room.sellMinor / 100).toFixed(2)}
                placeholder={(sellingMinor({ ...room, sellMinor: null }, quote) / 100).toFixed(2)}
                className={input}
              />
            </label>
            <PendingButton className={btnSecondary} pendingText="Setting…">
              Set
            </PendingButton>
            <p className="basis-full text-[11px] text-muted">{room.sellMinor === null ? "From the markup" : "Your price · empty it to use the markup"}</p>
          </ActionForm>
        )}
        <div className="text-[13px]">
          <p className="text-xs font-semibold text-[#37413d]">Profit</p>
          <p className={`font-bold ${profit <= 0 ? "text-[#9b3b2e]" : "text-ink"}`}>{formatMinor(profit, room.currency)}</p>
        </div>
        {canSetDate && latestClientDay ? (
          <ActionForm action={roomDateAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="roomId" value={room.id} />
            <div className="flex-1">
              <DateField name="date" label="Client sees free cancellation until" min={tomorrow} max={latestClientDay} today={today} defaultValue={client.kind === "free" ? client.until : ""} />
            </div>
            <PendingButton className={btnSecondary} pendingText="Setting…">
              Set
            </PendingButton>
            <p className="basis-full text-[11px] text-muted">Supplier deadline: {shortDate(room.freeCancelUntil ?? "")}. At least one day before it, so there is time to cancel for the client.</p>
          </ActionForm>
        ) : (
          <div />
        )}
        {frozen ? (
          <div />
        ) : (
          <ActionForm
            action={removeRoomAction}
            confirmText={picked ? "Remove the room chosen for the client? Removing it clears that selection. This cannot be undone." : `Remove ${room.roomName}? This cannot be undone.`}
          >
            <input type="hidden" name="roomId" value={room.id} />
            <PendingButton className={`${btnSecondary} text-[#9b3b2e]`} pendingText="Removing…">
              Remove
            </PendingButton>
          </ActionForm>
        )}
      </div>
      {!frozen && (canPick || (picked && canBook)) ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {picked ? (
            <>
              {canBook ? <BookButton stayId={stay.id} /> : null}
              {canPick ? (
                <ActionForm action={clearSelectionAction} confirmText="Clear this selection? The client sees no room chosen here until someone chooses again.">
                  <input type="hidden" name="stayId" value={stay.id} />
                  <PendingButton className={`${btnSecondary} min-h-9 px-3 text-xs`} pendingText="Clearing…">
                    Clear selection
                  </PendingButton>
                </ActionForm>
              ) : null}
            </>
          ) : canPick && !room.unavailable ? (
            // The client answered by phone or WhatsApp: the agent records the choice (marked as the
            // agent's) and can book it.
            <ActionForm action={selectForClientAction} confirmText={stay.selectedRoomId ? "Select this room for the client? It replaces the room chosen now for this destination." : undefined}>
              <input type="hidden" name="roomId" value={room.id} />
              <PendingButton className={`${btnSecondary} min-h-9 px-3 text-xs`} pendingText="Selecting…">
                Select for client
              </PendingButton>
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// "Price from <date>", and what the last "Refresh prices" found.
function PriceAge({ room }: { room: Room }) {
  const from = dayFmt.format(room.pricedAt);
  const flags: { text: string; bad: boolean }[] = [];
  if (room.unavailable) flags.push({ text: "No longer available at the last check. Remove it, or choose another room for the client.", bad: true });
  else if (room.needsRefresh) flags.push({ text: "Copied from another quote: refresh the prices before sending.", bad: true });
  if (!room.unavailable && room.previousNetMinor !== null) {
    const up = room.netMinor > room.previousNetMinor;
    flags.push({ text: `Net price ${up ? "up" : "down"} from ${money(room.previousNetMinor, room.currency)}`, bad: up });
  }
  if (!room.unavailable && room.cancelWorse) flags.push({ text: "Cancellation terms are worse than before", bad: true });
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px]">
      <span className="text-muted">Price from {from}</span>
      {flags.map((f) => (
        <span key={f.text} className={`font-semibold ${f.bad ? "text-[#9b3b2e]" : "text-[#2f7d4a]"}`}>
          · {f.text}
        </span>
      ))}
    </p>
  );
}

// "Client selections" (mockup 15): what the client sent from the client page, or the agent chose
// for the client ("Select for client"), per destination.
function ClientSelections({ quote, bookings }: { quote: QuoteDetail; bookings: Map<string, StayBooking> }) {
  if (!quote.selectedAt && !quote.stays.some((s) => s.selectedRoomId)) return null;
  const rows = quote.stays.map((stay) => {
    const hotel = stay.hotels.find((h) => h.rooms.some((r) => r.id === stay.selectedRoomId));
    const room = hotel?.rooms.find((r) => r.id === stay.selectedRoomId);
    return { stay, hotel, room };
  });
  const picked = rows.filter((r) => r.room);
  const total = picked.reduce((n, r) => n + (r.room ? sellingMinor(r.room, quote) : 0), 0);
  return (
    <section id="selections" aria-labelledby="selections-title" className="scroll-mt-24 overflow-hidden rounded-[18px] border border-brand bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-brand px-5 py-3 text-paper">
        <div>
          <h2 id="selections-title" className="text-base font-bold">
            Client selections
          </h2>
          <p className="text-xs text-[#cfe2d8]">
            {quote.selectedAt ? `Client sent ${dayMonth.format(quote.selectedAt)}. ` : ""}The client can change a destination until you book it.
          </p>
        </div>
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
          {picked.length} of {quote.stays.length} destinations selected
        </span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-3">
        {rows.map(({ stay, hotel, room }) => (
          <div key={stay.id} className={`rounded-[12px] border p-3 ${room ? "border-[#bcd0c6] bg-brand-soft" : "border-dashed border-line"}`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5f6863]">{stay.destinationName.split(",")[0]}</p>
            {room && hotel ? (
              <>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
                  {hotel.name}
                  <PickBadge byAgent={stay.selectedByAgent} />
                </p>
                <p className="text-[13px] text-[#37413d]">{room.roomName}</p>
                <p className="text-xs text-muted">
                  {shortDate(stay.checkin)} to {shortDate(stay.checkout)}
                </p>
                <p className="mt-2 text-[14px] font-bold text-ink">{money(sellingMinor(room, quote), room.currency)}</p>
                {stay.selectedSellMinor !== null && stay.selectedSellMinor !== sellingMinor(room, quote) ? (
                  <p role="note" className="mt-1 text-xs font-semibold text-[#9b3b2e]">
                    The client chose this at {money(stay.selectedSellMinor, stay.selectedCurrency ?? room.currency)}. The price changed since.
                  </p>
                ) : null}
                <StayBookingLine booking={bookings.get(stay.id)} stayId={stay.id} canBook={quote.status !== "BOOKED" && quote.closedAt === null} />
              </>
            ) : (
              <p className="mt-1 text-[13px] text-muted">No hotel selected</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-[13px]">
        <span className="text-muted">{quote.clientNote ? `Client note: ${quote.clientNote}` : "Selected trip total, complete destinations only. Hotel taxes are paid at the hotel."}</span>
        <strong className="text-[16px] text-ink">{money(total)}</strong>
      </div>
    </section>
  );
}

// Under a picked room: its booking, or "Book this room" (searches the hotel again, then the normal
// guest details and review pages check the price).
function StayBookingLine({ booking, stayId, canBook }: { booking: StayBooking | undefined; stayId: string; canBook: boolean }) {
  if (booking) {
    return (
      <p className="mt-2 text-xs font-semibold text-brand">
        {booking.status === "CONFIRMED" ? "Booked" : "Booking pending"} ·{" "}
        <Link href={`/bookings/${booking.id}`} className="underline">
          {booking.reference}
        </Link>
      </p>
    );
  }
  if (!canBook) return null;
  return (
    <div className="mt-2">
      <BookButton stayId={stayId} />
    </div>
  );
}

// "Book this room" for the room chosen on a destination (by the client or by the agent for the
// client): the hotel is searched again, then the normal guest details and review pages.
function BookButton({ stayId }: { stayId: string }) {
  return (
    <ActionForm action={bookFromQuoteAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="stayId" value={stayId} />
      <PendingButton className={`${btnPrimary} min-h-9 px-3 text-xs`} pendingText="Checking the room…">
        Book this room
      </PendingButton>
    </ActionForm>
  );
}

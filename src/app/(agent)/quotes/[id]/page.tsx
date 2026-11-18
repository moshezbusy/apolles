import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { btnPrimary, btnSecondary, card, input, label, link } from "@/components/ui";
import { formatMinor } from "@/lib/supplier-money";
import { requireAgent } from "@/server/auth/guards";
import { clientOptions } from "@/server/clients";
import { sellingMinor } from "@/server/quotes/pricing";
import { getQuote, quoteCode, quoteNumbers, type QuoteDetail } from "@/server/quotes/quotes";
import type { PriceBreakdown } from "@/server/supplier/types";
import { dateRange } from "../../search/dates";
import { DestinationPicker } from "../../search/destination-picker";
import { Stars, shortDate } from "../../search/parts";
import { ActionForm } from "../action-form";
import { addStayAction, copyLinkAction, emailAction, hotelAction, removeRoomAction, removeStayAction, roomDateAction, roomPriceAction, saveSettingsAction, whatsappAction } from "../actions";
import { shareUrl } from "@/server/quotes/sharing";
import { SendPanel } from "./send-panel";
import { StatusPill, guestsText } from "../parts";

export const metadata: Metadata = { title: "Quote | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

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
export default async function QuoteEditorPage({ params }: { params: Params }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const quote = await getQuote(agencyId, id);
  if (!quote) notFound();
  const options = await clientOptions(agencyId);
  // The quote's own client is always in the list, so "Save changes" never drops it silently.
  const clients = quote.client && !options.some((c) => c.id === quote.client?.id) ? [quote.client, ...options] : options;
  const totals = quoteNumbers(quote);
  const roomCount = totals.options;
  const { minDate, maxDate } = dateRange(new Date());

  return (
    <main className="mx-auto flex w-[min(1100px,calc(100%-40px))] flex-col gap-5 pb-16 pt-6">
      <Link href="/quotes" className={link}>
        ← Back to quotes
      </Link>

      <ActionForm action={saveSettingsAction} className="flex flex-col gap-5">
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
              className={`${input} font-serif text-[22px]`}
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
            <StatusPill status={quote.status} />
            <button type="submit" className={btnPrimary}>
              Save changes
            </button>
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
              <select name="clientId" defaultValue={quote.client?.id ?? ""} className={input}>
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
            <Link href="/clients?new=1" className={link}>
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
          actions={{ copy: copyLinkAction, whatsapp: whatsappAction, email: emailAction }}
        />
      </section>

      <ClientSelections quote={quote} />

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
          <StaySection key={stay.id} quote={quote} stay={stay} />
        ))}

        <section className={`${card} bg-white p-5`}>
          <h3 className={sectionHead}>+ Add destination</h3>
          <ActionForm action={addStayAction} className="mt-3 grid items-end gap-3 md:grid-cols-[1.6fr_1fr_1fr_auto]">
            <input type="hidden" name="quoteId" value={quote.id} />
            <div className={label}>
              <span>Destination</span>
              <DestinationPicker defaultId="" defaultLabel="" />
            </div>
            <label className={label}>
              Check-in
              <input type="date" name="checkin" required min={minDate} max={maxDate} className={input} />
            </label>
            <label className={label}>
              Check-out
              <input type="date" name="checkout" required min={minDate} max={maxDate} className={input} />
            </label>
            <button type="submit" className={btnSecondary}>
              Add destination
            </button>
          </ActionForm>
        </section>

        <p className="text-center text-xs text-muted">Rates and availability remain subject to change until booking is confirmed.</p>
      </section>
    </main>
  );
}

type Stay = QuoteDetail["stays"][number];
type Hotel = Stay["hotels"][number];
type Room = Hotel["rooms"][number];

function StaySection({ quote, stay }: { quote: QuoteDetail; stay: Stay }) {
  const n = nights(stay.checkin, stay.checkout);
  return (
    <section className={`${card} overflow-hidden bg-white`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h3 className="text-[15px] font-bold text-ink">{stay.destinationName}</h3>
          <p className="text-xs text-muted">
            {shortDate(stay.checkin)} to {shortDate(stay.checkout)} · {n} {n === 1 ? "night" : "nights"} · {stay.hotels.length} {stay.hotels.length === 1 ? "hotel" : "hotels"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/search?quote=${quote.id}&stay=${stay.id}`} className={btnSecondary}>
            + Add hotel
          </Link>
          <ActionForm action={removeStayAction}>
            <input type="hidden" name="stayId" value={stay.id} />
            <button type="submit" className={`${btnSecondary} text-[#9b3b2e]`}>
              Remove destination
            </button>
          </ActionForm>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {stay.hotels.length === 0 ? (
          <p className="text-sm text-muted">No hotels yet. &quot;+ Add hotel&quot; opens Search with these dates and guests.</p>
        ) : (
          stay.hotels.map((hotel, i) => <HotelBlock key={hotel.id} quote={quote} hotel={hotel} nightsCount={n} first={i === 0} last={i === stay.hotels.length - 1} />)
        )}
      </div>
    </section>
  );
}

function HotelBlock({ quote, hotel, nightsCount, first, last }: { quote: QuoteDetail; hotel: Hotel; nightsCount: number; first: boolean; last: boolean }) {
  const sells = hotel.rooms.map((r) => sellingMinor(r, quote));
  const lowest = sells.length ? Math.min(...sells) : null;
  const tool = (what: string, text: string, title: string, disabled = false) => (
    <ActionForm action={hotelAction}>
      <input type="hidden" name="hotelId" value={hotel.id} />
      <input type="hidden" name="do" value={what} />
      <button type="submit" className={`${iconBtn} ${what === "pick" && hotel.agencyPick ? "border-[#e6d3a3] bg-[#fff6dc] text-[#8a6a10]" : ""}`} title={title} aria-label={title} disabled={disabled}>
        {text}
      </button>
    </ActionForm>
  );
  return (
    <article className={`rounded-[12px] border ${hotel.agencyPick ? "border-[#e6d3a3]" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[200px] flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
            {hotel.name}
            {hotel.agencyPick ? <span className="rounded-full bg-[#fff6dc] px-2 py-0.5 text-[11px] font-bold text-[#8a6a10]">Agency pick</span> : null}
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
          {tool("remove", "×", "Remove hotel")}
        </div>
      </div>
      {hotel.rooms.map((room) => (
        <RoomBlock key={room.id} quote={quote} room={room} />
      ))}
    </article>
  );
}

function RoomBlock({ quote, room }: { quote: QuoteDetail; room: Room }) {
  const sell = sellingMinor(room, quote);
  const profit = sell - room.netMinor;
  const price = room.price as unknown as PriceBreakdown;
  const atHotel = price?.dueAtPropertyTotal ?? null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="border-t border-line bg-[#fbfaf7] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-bold text-ink">{room.roomName}</p>
          <p className="text-xs text-muted">
            {room.bedDescription}
            {atHotel ? ` · + ${formatMinor(atHotel.minor, atHotel.currency)} paid at the hotel` : ""}
            {" · "}
            {room.refundable && room.freeCancelUntil ? (
              <span className="text-[#2f7d4a]">
                Free cancellation until {shortDate(room.freeCancelUntil)}
                {room.clientCancelUntil ? <span className="font-semibold text-[#8a6a10]"> · client sees {shortDate(room.clientCancelUntil)}</span> : null}
              </span>
            ) : (
              <span className="text-[#9b3b2e]">Non-refundable</span>
            )}
          </p>
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
        <ActionForm action={roomPriceAction} className="flex flex-wrap items-end gap-2">
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
          <button type="submit" className={btnSecondary}>
            Set
          </button>
          <p className="basis-full text-[11px] text-muted">{room.sellMinor === null ? "From the markup" : "Your price · empty it to use the markup"}</p>
        </ActionForm>
        <div className="text-[13px]">
          <p className="text-xs font-semibold text-[#37413d]">Profit</p>
          <p className={`font-bold ${profit < 0 ? "text-[#9b3b2e]" : "text-ink"}`}>{formatMinor(profit, room.currency)}</p>
        </div>
        {room.refundable && room.freeCancelUntil ? (
          <ActionForm action={roomDateAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="roomId" value={room.id} />
            <label className={`${label} flex-1`}>
              Client sees free cancellation until
              <input type="date" name="date" min={today} max={room.freeCancelUntil} defaultValue={room.clientCancelUntil ?? ""} className={input} />
            </label>
            <button type="submit" className={btnSecondary}>
              Set
            </button>
            <p className="basis-full text-[11px] text-muted">Supplier deadline: {shortDate(room.freeCancelUntil)}. Same date as the supplier or earlier only.</p>
          </ActionForm>
        ) : (
          <div />
        )}
        <ActionForm action={removeRoomAction}>
          <input type="hidden" name="roomId" value={room.id} />
          <button type="submit" className={`${btnSecondary} text-[#9b3b2e]`}>
            Remove
          </button>
        </ActionForm>
      </div>
    </div>
  );
}

// "Client selections" (mockup 15): what the client sent from the client page, per destination.
function ClientSelections({ quote }: { quote: QuoteDetail }) {
  if (!quote.selectedAt) return null;
  const rows = quote.stays.map((stay) => {
    const hotel = stay.hotels.find((h) => h.rooms.some((r) => r.id === stay.selectedRoomId));
    const room = hotel?.rooms.find((r) => r.id === stay.selectedRoomId);
    return { stay, hotel, room };
  });
  const picked = rows.filter((r) => r.room);
  const total = picked.reduce((n, r) => n + (r.room ? sellingMinor(r.room, quote) : 0), 0);
  return (
    <section aria-labelledby="selections-title" className="overflow-hidden rounded-[18px] border border-brand bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-brand px-5 py-3 text-paper">
        <div>
          <h2 id="selections-title" className="text-base font-bold">
            Client selections
          </h2>
          <p className="text-xs text-[#cfe2d8]">Sent {dayMonth.format(quote.selectedAt)}. The client can change it until you book.</p>
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
                <p className="mt-1 text-[14px] font-bold text-ink">{hotel.name}</p>
                <p className="text-[13px] text-[#37413d]">{room.roomName}</p>
                <p className="text-xs text-muted">
                  {shortDate(stay.checkin)} to {shortDate(stay.checkout)}
                </p>
                <p className="mt-2 text-[14px] font-bold text-ink">{money(sellingMinor(room, quote), room.currency)}</p>
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

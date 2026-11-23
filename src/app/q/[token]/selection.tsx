"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatMinor } from "@/lib/supplier-money";
import type { ClientQuote, ClientRoom } from "@/server/quotes/sharing";
import { recordViewAction, submitSelectionAction } from "./actions";
import { day, nightsBetween, texts, type Lang } from "./texts";

type Photos = Record<string, string>;

// The client's choice (screens 16, 17): one hotel and room per destination, or none. Tapping the
// chosen room again unselects it. "Send my selections" sends the choice and the note; it books
// nothing and takes no card. The view is counted from here (in the browser), so link previews and
// bots never count as the client opening the proposal.
// Read-only (nothing can be chosen or sent) when the offer expired, the agent closed the quote, or
// every destination is booked. A destination that is booked (shown as "Confirmed") or whose dates
// passed is read-only by itself; the others can still be chosen.
export function Selection({ token, quote, photos, lang }: { token: string | null; quote: ClientQuote; photos: Photos; lang: Lang }) {
  // token null: the agent's preview. Nothing is counted or sent.
  const t = texts(lang);
  const router = useRouter();
  const locked = quote.state !== "open";
  const notice =
    quote.state === "expired"
      ? { title: t.expiredTitle, text: t.expiredText }
      : quote.state === "closed"
        ? { title: t.closedTitle, text: t.closedText }
        : quote.state === "booked"
          ? { title: t.lockedTitle, text: t.lockedText }
          : null;
  const [allPicks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(quote.stays.filter((s) => s.selectedRoomId).map((s) => [s.id, s.selectedRoomId as string])),
  );
  const [note, setNote] = useState(quote.clientNote);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(quote.status === "SELECTED" ? { kind: "ok", text: t.lastSent } : null);
  const [pending, start] = useTransition();
  // After a send in this visit, the client may also clear every pick and send again.
  const [sentOnce, setSentOnce] = useState(quote.status === "SELECTED");

  const rooms = useMemo(() => {
    const map = new Map<string, ClientRoom>();
    for (const s of quote.stays) for (const h of s.hotels) for (const r of h.rooms) map.set(r.id, r);
    return map;
  }, [quote]);
  // After the offer was updated (the page reads it again), a choice of a room that is no longer
  // offered is dropped; the others stay.
  const picks = useMemo(() => Object.fromEntries(Object.entries(allPicks).filter(([, roomId]) => rooms.has(roomId))), [allPicks, rooms]);
  const chosen = Object.values(picks).map((id) => rooms.get(id)).filter((r): r is ClientRoom => !!r);
  const total = chosen.reduce((n, r) => n + r.sellMinor, 0);
  const staysWithHotels = quote.stays.filter((s) => s.hotels.length > 0);

  function toggle(stayId: string, roomId: string) {
    const stay = quote.stays.find((s) => s.id === stayId);
    if (locked || !stay || stay.booked || stay.past) return;
    setPicks((p) => {
      const next = { ...p };
      if (next[stayId] === roomId) delete next[stayId];
      else next[stayId] = roomId;
      return next;
    });
    setMessage(null);
  }

  function send() {
    if (!token) return;
    // The price shown for each chosen room goes with the choice: the server records it only if
    // it is still the price (an open page can be days old).
    const seen = Object.fromEntries(chosen.map((room) => [room.id, room.sellMinor]));
    start(async () => {
      const result = await submitSelectionAction(token, picks, note, seen);
      if (result.ok) {
        setMessage({ kind: "ok", text: t.sent });
        setSentOnce(true);
        return;
      }
      const text = {
        limited: t.limited,
        locked: t.lockedText,
        prices: t.pricesChanged,
        updated: t.offerUpdated,
        expired: t.expiredText,
        closed: t.closedText,
        invalid: t.failed,
        gone: t.failed,
      }[result.error];
      setMessage({ kind: "error", text });
      // Anything but a plain failure means the page is out of date: read the offer again. The
      // choices stay (those whose room is gone are dropped above).
      if (result.error !== "limited" && result.error !== "invalid") router.refresh();
    });
  }

  return (
    <>
      <ViewPing token={token} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[620px]">
          <h2 className="text-[20px] font-bold text-ink">{t.choose}</h2>
          {!locked ? <p className="mt-1 text-[14px] text-muted">{t.chooseHelp}</p> : null}
        </div>
        <div className="text-end">
          <p className="text-[15px] font-bold text-ink">{t.selectedOf(Object.keys(picks).length, staysWithHotels.length)}</p>
          {!locked ? <p className="text-xs text-muted">{t.tapRoom}</p> : null}
        </div>
      </div>

      {notice ? (
        <div role="status" className="rounded-[14px] border border-[#d3e3da] bg-brand-soft p-4 text-brand">
          <strong className="block">{notice.title}</strong>
          <span className="text-[14px]">{notice.text}</span>
        </div>
      ) : null}

      {quote.stays.map((stay, i) => {
        const pick = picks[stay.id];
        const n = nightsBetween(stay.checkin, stay.checkout);
        return (
          <section key={stay.id} className="overflow-hidden rounded-[18px] border border-line bg-white">
            <header className="flex items-center gap-3 border-b border-line p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-paper">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-bold text-ink">{stay.destinationName.split(",")[0]}</h3>
                <p className="text-[13px] text-muted">
                  {day(stay.checkin, lang)} {t.to} {day(stay.checkout, lang)} · {t.nights(n)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${pick ? "bg-brand-soft text-brand" : "bg-[#f1efe9] text-[#5f6863]"}`}>
                {stay.confirmed ? t.bookedStay : stay.booked ? t.bookingStay : stay.past ? t.pastStay : pick ? t.selected : t.noSelection}
              </span>
            </header>
            <div className="flex flex-col gap-3 p-3">
              {stay.hotels.map((hotel) => {
                const lowest = Math.min(...hotel.rooms.map((r) => r.sellMinor));
                const isOpen = open[hotel.id] ?? hotel.rooms.some((r) => r.id === pick);
                const photo = photos[hotel.id];
                return (
                  <article key={hotel.id} className={`rounded-[14px] border ${hotel.rooms.some((r) => r.id === pick) ? "border-brand" : "border-line"}`}>
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [hotel.id]: !isOpen }))}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 p-3 text-start"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- supplier image host only (i.travelapi.com), checked on the server */}
                      {photo ? <img src={photo} alt="" className="h-[66px] w-[84px] shrink-0 rounded-[10px] object-cover" referrerPolicy="no-referrer" /> : <span className="h-[66px] w-[84px] shrink-0 rounded-[10px] bg-[#e9e4da]" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">
                          {hotel.name}
                          {hotel.agencyPick ? <span className="rounded-full bg-[#fff6dc] px-2 py-0.5 text-[11px] font-bold text-[#8a6a10]">{t.agencyPick}</span> : null}
                        </span>
                        <span className="block text-[13px] text-muted">{hotel.city}</span>
                        {hotel.starRating ? (
                          <span aria-label={`${hotel.starRating} stars`} className="block text-[13px] text-gold">
                            {"★".repeat(Math.round(Number(hotel.starRating)))}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-end">
                        <span className="block text-[15px] font-bold text-ink">
                          {hotel.rooms.length > 1 ? `${t.from} ` : ""}
                          {formatMinor(lowest, "USD")}
                        </span>
                        <span className="block text-xs text-muted">{t.nightTotal(n)}</span>
                        <span className="mt-1 block text-xs font-semibold text-brand">{isOpen ? t.hideRooms : t.showRooms}</span>
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className="flex flex-col gap-2 border-t border-line bg-[#fbfaf7] p-3">
                        {hotel.rooms.map((room) => {
                          const on = pick === room.id;
                          return (
                            <li key={room.id}>
                              <button
                                type="button"
                                onClick={() => toggle(stay.id, room.id)}
                                aria-pressed={on}
                                disabled={locked || stay.booked || stay.past}
                                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-[12px] border bg-white p-3 text-start ${on ? "border-brand ring-2 ring-brand/30" : "border-line hover:border-[#bcd0c6]"}`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-[14px] font-bold text-ink">{room.roomName}</span>
                                  <span className="block text-xs text-muted">{room.bedDescription}</span>
                                  {room.amenities.length > 0 ? (
                                    <span className="block text-xs text-[#37413d]">
                                      {t.rateIncludes}: {room.amenities.join(", ")}
                                    </span>
                                  ) : null}
                                  {room.cancel ? (
                                    // A date that passed is never shown as free cancellation.
                                    <span className={`block text-xs font-semibold ${room.cancel.kind === "free" ? "text-[#2f7d4a]" : "text-[#9b3b2e]"}`}>
                                      {room.cancel.kind === "free" ? t.freeUntil(day(room.cancel.until, lang, true)) : room.cancel.kind === "ended" ? t.freeEnded(day(room.cancel.on, lang, true)) : t.nonRefundable}
                                    </span>
                                  ) : null}
                                  {room.dueAtHotel ? (
                                    <span className="block text-xs text-[#8a6a10]">
                                      {t.paidAtHotel(
                                        formatMinor(room.dueAtHotel.minor, room.dueAtHotel.currency) +
                                          (room.dueAtHotel.localMinor !== null && room.dueAtHotel.localCurrency && room.dueAtHotel.localCurrency !== room.dueAtHotel.currency
                                            ? ` (${formatMinor(room.dueAtHotel.localMinor, room.dueAtHotel.localCurrency)})`
                                            : ""),
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="text-end">
                                  <span className="block text-[15px] font-bold text-ink">{formatMinor(room.sellMinor, room.currency)}</span>
                                  {on ? <span className="block text-xs font-bold text-brand">{t.selected}</span> : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="rounded-[14px] bg-[#f1efe9] p-4 text-[13px] text-[#4d5a54]">{t.note}</p>

      {!locked ? (
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
          {t.noteLabel}
          <textarea
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            className="rounded-[12px] border border-[#d9e1dc] bg-white p-3 text-[14px] font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/40"
          />
        </label>
      ) : null}

      {!locked ? (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line bg-white p-3 shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">{t.barTitle}</p>
            <p role={message?.kind === "error" ? "alert" : "status"} className={`text-[13px] ${message?.kind === "error" ? "text-[#9b3b2e]" : message ? "text-brand" : "text-muted"}`}>
              {message ? message.text : chosen.length ? chosen.map((r) => r.roomName).join(" · ") : t.nothingYet}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-end">
              <p className="text-xs text-muted">{t.total}</p>
              <p className="text-[18px] font-bold text-ink">{formatMinor(total, "USD")}</p>
            </div>
            <button
              type="button"
              onClick={send}
              disabled={!token || pending || (chosen.length === 0 && !sentOnce)}
              className="min-h-[44px] rounded-[12px] bg-brand px-5 text-[14px] font-bold text-paper hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? t.sending : sentOnce ? t.update : t.send}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Counts the client's view from the browser (link previews and bots never run it). Nothing for
// the agent's preview (no token).
export function ViewPing({ token }: { token: string | null }) {
  useEffect(() => {
    if (token) void recordViewAction(token);
  }, [token]);
  return null;
}

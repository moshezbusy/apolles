import { initials } from "@/components/Header";
import { safeImageUrl } from "@/lib/supplier-image";
import { toBlocks } from "@/lib/supplier-text";
import { getCachedContent, getContent } from "@/server/content/content-cache";
import type { ClientQuote, ClientQuoteData } from "@/server/quotes/sharing";
import { type HotelDetails, Selection, ViewPing } from "./selection";
import { day, texts, type Lang } from "./texts";

// The proposal as the client sees it. The agent's Preview (/quotes/[id]/preview) draws the same
// page with `token` null: nothing is counted and nothing can be sent from it.
// Hotel photos and details for the proposal, by our own hotel id (the supplier's id stays on the
// server). Best effort: the page still works without them. "cache": the public client page,
// which reads our own cache only and never calls the supplier. "fetch": the signed-in agent's
// Preview, which may fetch missing content (and so fills the cache for the client). The
// description is turned into plain text blocks (supplier HTML never reaches the page as HTML).
export type ProposalContent = { photos: Record<string, string>; details: Record<string, HotelDetails> };

const MAX_PHOTOS = 12;

export async function proposalContent(data: ClientQuoteData, source: "cache" | "fetch"): Promise<ProposalContent> {
  const photos: Record<string, string> = {};
  const details: Record<string, HotelDetails> = {};
  try {
    const ids = [...new Set(Object.values(data.propertyByHotel))];
    const content = ids.length === 0 ? new Map() : source === "cache" ? await getCachedContent(ids) : await getContent(ids);
    for (const [hotelId, propertyId] of Object.entries(data.propertyByHotel)) {
      const c = content.get(propertyId);
      const url = safeImageUrl(c?.heroImage?.url);
      if (url) photos[hotelId] = url;
      if (!c) continue;
      const images = [c.heroImage, ...c.images].map((i) => safeImageUrl(i?.url)).filter((u): u is string => !!u);
      details[hotelId] = {
        photos: [...new Set(images)].slice(0, MAX_PHOTOS),
        description: toBlocks(c.description).slice(0, 30),
        address: [c.address.line1, c.address.city, c.address.stateProvince].filter(Boolean).join(", "),
      };
    }
  } catch (error) {
    console.error(`client quote content failed: ${error instanceof Error ? error.name : "Error"}`);
  }
  return { photos, details };
}

export function Proposal({ quote, token, logoSrc, content }: { quote: ClientQuote; token: string | null; logoSrc: string; content: ProposalContent }) {
  const lang: Lang = quote.language;
  const t = texts(lang);

  const checkins = quote.stays.map((s) => s.checkin).sort();
  const checkouts = quote.stays.map((s) => s.checkout).sort();
  // The agency's number in its international form; none when it cannot be made for sure (a
  // button to a wrong number is worse than no button).
  const phoneDigits = quote.agency.phoneE164;
  const hasRooms = quote.stays.some((s) => s.hotels.length > 0);
  const greeting = quote.message || (lang === "HE" ? `היי${quote.clientFirstName ? ` ${quote.clientFirstName}` : ""}, בחרתי עבורך את אפשרויות המלונות האלה. בחרו את המלון והחדר שאתם מעדיפים בכל יעד.` : `Hi${quote.clientFirstName ? ` ${quote.clientFirstName}` : ""}, I selected these hotel options for your trip. Choose the hotel and room you prefer in each destination.`);

  return (
    <div
      dir={lang === "HE" ? "rtl" : "ltr"}
      lang={lang === "HE" ? "he" : "en"}
      className="flex min-h-full flex-1 flex-col bg-canvas"
      // The agency's brand color (screen 20, only #rrggbb) replaces the green on this page.
      style={quote.agency.brandColor ? ({ "--color-brand": quote.agency.brandColor, "--color-brand-dark": quote.agency.brandColor } as React.CSSProperties) : undefined}
    >
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex w-[min(1040px,calc(100%-32px))] items-center gap-3 py-3">
          {quote.agency.logoSha256 ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own route, found by the token
            <img src={logoSrc} alt={quote.agency.name} className="h-10 max-w-[160px] object-contain" />
          ) : (
            <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#efe8da] font-serif text-[15px] text-[#8a6a3a]">
              {initials(quote.agency.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink">{quote.agency.name}</p>
            <p className="truncate text-xs text-muted">
              {quote.agentName} · {t.advisor}
            </p>
          </div>
          {phoneDigits ? (
            <>
              <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-brand px-4 py-2 text-[13px] font-bold text-paper hover:bg-brand-dark">
                {t.whatsapp}
              </a>
              <a href={`tel:+${phoneDigits}`} className="rounded-full border border-line px-4 py-2 text-[13px] font-bold text-ink hover:border-[#bcd0c6]">
                {t.call}
              </a>
            </>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex w-[min(1000px,calc(100%-32px))] flex-col gap-5 py-6">
        <section className="rounded-[22px] bg-gradient-to-br from-brand to-brand-2 p-6 text-paper sm:p-8">
          <p className={`text-xs font-extrabold text-[#cfe2d8] ${lang === "HE" ? "" : "uppercase tracking-[0.16em]"}`}>{t.proposal}</p>
          <h1 className="mt-2 font-serif text-[30px] leading-tight sm:text-[40px]">{quote.title || t.proposal}</h1>
          <p className="mt-3 max-w-[680px] whitespace-pre-line text-[15px] text-[#e3eee8]">{greeting}</p>
          <p className="mt-4 flex flex-wrap gap-2 text-[13px] font-bold">
            {checkins[0] && checkouts.at(-1) ? (
              <span className="rounded-full bg-white/15 px-3 py-1">
                {day(checkins[0], lang)} {t.to} {day(checkouts.at(-1) ?? "", lang, true)}
              </span>
            ) : null}
            <span className="rounded-full bg-white/15 px-3 py-1">
              {t.adults(quote.adults)}
              {quote.childAges.length ? ` · ${t.children(quote.childAges.length)}` : ""}
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1">{t.destinations(quote.stays.length)}</span>
            {quote.state === "open" && quote.validLastDay ? <span className="rounded-full bg-white/15 px-3 py-1">{t.validUntil(day(quote.validLastDay, lang, true))}</span> : null}
          </p>
        </section>

        {hasRooms ? (
          <Selection token={token} quote={quote} photos={content.photos} details={content.details} lang={lang} />
        ) : (
          <div className="rounded-[18px] border border-line bg-white p-6 text-center">
            <ViewPing token={token} />
            <strong className="block text-ink">{t.emptyTitle}</strong>
            <span className="text-[14px] text-muted">{t.emptyText}</span>
          </div>
        )}

        <footer className="py-6 text-center text-xs text-muted">
          <p>{t.footer(quote.code, quote.agency.name)}</p>
          <p>{t.footerHelp}</p>
        </footer>
      </main>
    </div>
  );
}

// Too many page loads from one address in a minute: a short notice in both languages (nothing of
// the quote is read).
export function Busy() {
  const en = texts("EN");
  const he = texts("HE");
  return (
    <main className="mx-auto flex w-[min(640px,calc(100%-32px))] flex-1 flex-col gap-6 py-16 text-center">
      <section>
        <h1 className="font-serif text-[28px] text-ink">{en.busyTitle}</h1>
        <p className="mt-2 text-[14px] text-muted">{en.busyText}</p>
      </section>
      <section dir="rtl" lang="he">
        <h2 className="font-serif text-[24px] text-ink">{he.busyTitle}</h2>
        <p className="mt-2 text-[14px] text-muted">{he.busyText}</p>
      </section>
    </main>
  );
}

export function Gone() {
  const en = texts("EN");
  const he = texts("HE");
  return (
    <main className="mx-auto flex w-[min(640px,calc(100%-32px))] flex-1 flex-col gap-6 py-16 text-center">
      <section>
        <h1 className="font-serif text-[28px] text-ink">{en.goneTitle}</h1>
        <p className="mt-2 text-[14px] text-muted">{en.goneText}</p>
      </section>
      <section dir="rtl" lang="he">
        <h2 className="font-serif text-[24px] text-ink">{he.goneTitle}</h2>
        <p className="mt-2 text-[14px] text-muted">{he.goneText}</p>
      </section>
    </main>
  );
}

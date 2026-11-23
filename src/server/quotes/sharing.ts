import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { audit } from "@/server/audit";
import { ipBucket } from "@/server/client-ip";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { PHONE_NEEDS_COUNTRY_CODE, toE164Digits } from "@/lib/phone";
import { formatMinor } from "@/lib/supplier-money";
import { type CancelView, clientCancelView, dayAhead, offerEnd, offerLastDay, offerOver, sellingMinor, todayIso } from "@/server/quotes/pricing";
import { quoteCode } from "@/server/quotes/quotes";
import { ACTIVE_BOOKING, syncQuoteBooked } from "@/server/quotes/quote-booking";
import { senderNameAllowed } from "@/server/quote-settings";
import { hitRateLimit } from "@/server/rate-limit";
import { normalizeEmail } from "@/server/users";
import type { PriceBreakdown } from "@/server/supplier/types";

// Sharing a quote with the client (screens 15, 16, 17; plan 5c). The client link holds an
// unguessable token (24 random bytes). It opens one quote read-only for the client, who can send
// selections; it never signs anyone in. Agent functions take the agencyId from the session; the
// public functions find the quote only by its token, and show the agency's selling prices only:
// never the net, the markup or anything of the supplier's.

// `confirm`: nothing was shared; the agent must say yes to it first (sending at cost price).
export type ShareResult = { ok: true; url: string } | { ok: false; error: string; confirm?: "netPrice" };
export type ShareOptions = { markSent?: boolean; confirmNetPrice?: boolean; now?: Date };

const TOKEN = /^[A-Za-z0-9_-]{32}$/;
// Emails in the agency's name: per agency 30 an hour and 100 a day, and 5 a day to one address.
const EMAIL_LIMIT = { limit: 30, windowMs: 60 * 60_000 };
const EMAIL_DAY_LIMIT = { limit: 100, windowMs: 24 * 60 * 60_000 };
const EMAIL_RECIPIENT_LIMIT = { limit: 5, windowMs: 24 * 60 * 60_000 };
const VIEW_LIMIT = { limit: 120, windowMs: 60_000 }; // per IP
// Opening the client page, per IP and whatever the link (so many links do not get around it).
// Visitors whose IP is not known share one, larger, count.
const PAGE_LIMIT = { limit: 60, unknownLimit: 600, windowMs: 60_000 };
const SELECT_IP_LIMIT = { limit: 60, unknownLimit: 600, windowMs: 60 * 60_000 }; // per IP, whatever the link
const SELECT_LIMIT = { limit: 20, windowMs: 60 * 60_000 }; // per IP and quote
const SELECT_QUOTE_LIMIT = { limit: 40, windowMs: 24 * 60 * 60_000 }; // per quote, whatever the IP
// Emails to the agent per quote: one for each real change, up to 6 an hour (the editor always shows
// the latest choice, and the email says so).
const NOTIFY_LIMIT = { limit: 6, windowMs: 60 * 60_000 };

const NOT_FOUND = "This quote was not found.";
const CLOSED = "This quote is closed. Choose Reopen quote to send it again.";
export const NET_PRICE =
  "0% markup: the client would see your cost price. Set a markup or a selling price and save, or confirm to send anyway.";

export function appUrl(): string {
  const parsed = z.url({ protocol: /^https?$/ }).safeParse(process.env.APP_URL);
  if (!parsed.success) throw new Error("APP_URL must be set to the app's address (http or https)");
  return parsed.data.replace(/\/$/, "");
}

export function shareUrl(token: string): string {
  return `${appUrl()}/q/${token}`;
}

// The agency's quote, with what sharing needs. null when it is not the agency's.
async function ownQuote(agencyId: string, quoteId: string) {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  return db.quote.findFirst({
    where: { id: quoteId, agencyId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      language: true,
      message: true,
      shareToken: true,
      closedAt: true,
      markupType: true,
      markupValue: true,
      client: { select: { firstName: true, email: true, phone: true } },
      agency: { select: { name: true, country: true, email: true, quoteDisplayName: true, quoteAdvisorName: true, quoteAdvisorEmail: true, quoteValidDays: true } },
      createdBy: { select: { name: true, email: true } },
      stays: { select: { checkin: true, hotels: { select: { rooms: { select: { netMinor: true, sellMinor: true } } } } } },
    },
  });
}

type OwnQuote = NonNullable<Awaited<ReturnType<typeof ownQuote>>>;

function roomsOf(quote: OwnQuote) {
  return quote.stays.flatMap((s) => s.hotels.flatMap((h) => h.rooms));
}

// A room the client would see at the agency's own cost (or below it) only because no markup was
// saved: the usual cause is a markup typed and never saved. A price the agent typed on the room
// is the agent's own decision and is not stopped here.
function showsCostPrice(quote: OwnQuote): boolean {
  return roomsOf(quote).some((room) => room.sellMinor === null && sellingMinor(room, quote) <= room.netMinor);
}

// Why this quote cannot go to the client right now, or null.
function shareRefusal(quote: OwnQuote, options: ShareOptions): Extract<ShareResult, { ok: false }> | null {
  if (quote.closedAt) return { ok: false, error: CLOSED };
  if (showsCostPrice(quote) && options.confirmNetPrice !== true) return { ok: false, error: NET_PRICE, confirm: "netPrice" };
  return null;
}

// Who the client sees as the sender: the quote branding of screen 20, else the agency's name and
// the agent's name. Replies go to the advisor email, else the agency's business email, else the
// agent's login email.
function quoteBrand(quote: {
  agency: { name: string; email: string | null; quoteDisplayName: string | null; quoteAdvisorName: string | null; quoteAdvisorEmail: string | null };
  createdBy: { name: string; email: string };
}) {
  return {
    displayName: quote.agency.quoteDisplayName ?? quote.agency.name,
    advisorName: quote.agency.quoteAdvisorName ?? quote.createdBy.name,
    replyTo: quote.agency.quoteAdvisorEmail ?? quote.agency.email ?? quote.createdBy.email,
  };
}

// The client link of the agency's quote, made on first use. Sharing marks a draft as sent and
// starts the offer's validity again ("Offer valid for (days)" of the agency).
export async function shareLink(
  actorUserId: string,
  agencyId: string,
  quoteId: string,
  channel: "link" | "whatsapp" | "email",
  options: ShareOptions = {},
): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  const refused = shareRefusal(quote, options);
  if (refused) return refused;
  const token = quote.shareToken ?? randomBytes(24).toString("base64url");
  await db.$transaction(async (tx) => {
    // updateMany with the old token: two clicks at once never make two different links.
    await tx.quote.updateMany({ where: { id: quote.id, agencyId, shareToken: null }, data: { shareToken: token } });
    if (options.markSent !== false) await markSent(tx, quote.id, offerEnd(options.now ?? new Date(), quote.agency.quoteValidDays));
    await audit(actorUserId, "quote.share", "Quote", quote.id, undefined, { channel }, tx);
  });
  const saved = await db.quote.findUniqueOrThrow({ where: { id: quote.id }, select: { shareToken: true } });
  return { ok: true, url: shareUrl(saved.shareToken ?? token) };
}

// "New link": the old client link stops working at once (a link sent to the wrong person, say).
// The new link starts a new validity period.
export async function renewLink(actorUserId: string, agencyId: string, quoteId: string, now: Date = new Date()): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  if (quote.closedAt) return { ok: false, error: CLOSED };
  const token = randomBytes(24).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.quote.updateMany({ where: { id: quote.id, agencyId }, data: { shareToken: token, validUntil: offerEnd(now, quote.agency.quoteValidDays) } });
    await audit(actorUserId, "quote.share.renew", "Quote", quote.id, undefined, undefined, tx);
  });
  return { ok: true, url: shareUrl(token) };
}

// "Extend offer": the same link is open to the client again for the agency's number of days.
// The prices are the stored ones (the agent checks them; refreshing prices is a separate step).
export async function extendOffer(actorUserId: string, agencyId: string, quoteId: string, now: Date = new Date()): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  if (quote.closedAt) return { ok: false, error: "This quote is closed. Choose Reopen quote first." };
  if (quote.status === "BOOKED") return { ok: false, error: "This quote is booked: there is nothing to extend." };
  if (!quote.shareToken) return { ok: false, error: "This quote was not sent yet. Send it to the client first." };
  const today = todayIso(now);
  if (quote.stays.length > 0 && quote.stays.every((s) => !dayAhead(s.checkin, today))) {
    return { ok: false, error: "The dates of this quote have passed. Add a destination with new dates to offer it again." };
  }
  await db.$transaction(async (tx) => {
    await tx.quote.updateMany({ where: { id: quote.id, agencyId }, data: { validUntil: offerEnd(now, quote.agency.quoteValidDays), editedAt: now } });
    await audit(actorUserId, "quote.offer.extend", "Quote", quote.id, undefined, { days: quote.agency.quoteValidDays }, tx);
  });
  return { ok: true, id: quote.id };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function markSent(tx: Tx, quoteId: string, validUntil: Date): Promise<void> {
  await tx.quote.updateMany({ where: { id: quoteId, status: "DRAFT" }, data: { status: "SENT" } });
  await tx.quote.update({ where: { id: quoteId }, data: { sentAt: new Date(), validUntil, editedAt: new Date() } });
}

// The text that goes with the link: the agent's message, or a short default in the quote's language.
export function shareText(quote: { language: "EN" | "HE"; message: string; client: { firstName: string } | null }, url: string): string {
  const name = quote.client?.firstName ?? "";
  const greeting =
    quote.language === "HE"
      ? `היי${name ? ` ${name}` : ""}, הנה אפשרויות המלונות לטיול שלכם.`
      : `Hi${name ? ` ${name}` : ""}, here are the hotel options for your trip.`;
  return `${quote.message || greeting}\n\n${url}`;
}

// wa.me opens the agent's own WhatsApp with the text ready; nothing is sent by Apolles. The
// number goes in its international form (a local one gets the country's code); null when the
// stored number cannot be turned into one for sure.
export function whatsappUrl(phone: string, country: string, text: string): string | null {
  const digits = toE164Digits(phone, country);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export async function whatsappLink(actorUserId: string, agencyId: string, quoteId: string, options: ShareOptions = {}): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  if (!quote.client) return { ok: false, error: "Choose the client first." };
  // Checked before the quote is marked sent: a link to a wrong number sends nothing.
  if (!toE164Digits(quote.client.phone, quote.agency.country)) return { ok: false, error: `The client's WhatsApp number has no country code. ${PHONE_NEEDS_COUNTRY_CODE}` };
  const shared = await shareLink(actorUserId, agencyId, quoteId, "whatsapp", options);
  if (!shared.ok) return shared;
  const url = whatsappUrl(quote.client.phone, quote.agency.country, shareText(quote, shared.url));
  return url ? { ok: true, url } : { ok: false, error: PHONE_NEEDS_COUNTRY_CODE };
}

// Never the address itself in a rate-limit key: its sha256.
function recipientKey(agencyId: string, email: string): string {
  return `quote-email:to:${agencyId}:${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
}

// Apolles emails the client the link, in the agency's name. So that this cannot be used to send
// any text to any address under any name: a quote with no room options is not sent, the sender
// name must be the agency's own (never Apolles or a system-looking name), the body starts with a
// fixed line saying who sent it, and sending is capped per hour, per day and per recipient.
export async function emailQuote(
  actorUserId: string,
  agencyId: string,
  quoteId: string,
  options: ShareOptions = {},
): Promise<{ ok: true } | { ok: false; error: string; confirm?: "netPrice" }> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  if (!quote.client?.email) return { ok: false, error: "The client has no email. Add one on the client's card, or send by WhatsApp." };
  if (roomsOf(quote).length === 0) return { ok: false, error: "This quote has no room options yet. Add at least one room, then send it." };
  const refused = shareRefusal(quote, options);
  if (refused) return refused;
  const brand = quoteBrand(quote);
  if (!senderNameAllowed(brand.displayName)) {
    return { ok: false, error: "The display name of your quotes cannot be used as an email sender. Change it in Settings, Quote branding, then send again." };
  }
  const limits = [
    { key: `quote-email:agency:${agencyId}`, ...EMAIL_LIMIT, error: "Too many emails this hour. Try again later, or send by WhatsApp." },
    { key: `quote-email:agency-day:${agencyId}`, ...EMAIL_DAY_LIMIT, error: "Your agency reached the daily limit of quote emails. Try again tomorrow, or send by WhatsApp." },
    { key: recipientKey(agencyId, quote.client.email), ...EMAIL_RECIPIENT_LIMIT, error: "This client already got several quote emails today. Send the link by WhatsApp, or try again tomorrow." },
  ];
  for (const { key, limit, windowMs, error } of limits) {
    const { allowed } = await hitRateLimit(key, limit, windowMs);
    if (!allowed) return { ok: false, error };
  }
  const shared = await shareLink(actorUserId, agencyId, quoteId, "email", { ...options, markSent: false });
  if (!shared.ok) return shared;
  const { subject, text } = emailContent(quote, brand, shared.url);
  try {
    await sendEmail({
      to: quote.client.email,
      subject,
      text,
      fromName: brand.displayName,
      ...(brand.replyTo ? { replyTo: brand.replyTo } : {}),
    });
  } catch (error) {
    // Logged by name only (never the address or the body); the quote stays as it was.
    console.error(`quote email failed: ${error instanceof Error ? error.name : "Error"}`);
    return { ok: false, error: "The email could not be sent right now. Try again in a few minutes, or send by WhatsApp." };
  }
  await db.$transaction(async (tx) => {
    await markSent(tx, quote.id, offerEnd(options.now ?? new Date(), quote.agency.quoteValidDays));
    await audit(actorUserId, "quote.email", "Quote", quote.id, undefined, { channel: "email" }, tx);
  });
  return { ok: true };
}

// The email to the client, exactly as "Send by email" sends it (the dialog shows the same).
function emailContent(quote: Pick<OwnQuote, "language" | "title" | "message" | "client">, brand: ReturnType<typeof quoteBrand>, url: string): { subject: string; text: string } {
  const subject =
    quote.language === "HE"
      ? `${quote.title || "הצעת נסיעה"} · ${brand.displayName}`
      : `${quote.title || "Your travel proposal"} · ${brand.displayName}`;
  // Always first, before the agent's own words: who this email is from and what it is.
  const intro = quote.language === "HE" ? `${brand.displayName} שלחו לך הצעת נסיעה.` : `${brand.displayName} sent you a travel proposal.`;
  const signature = `${brand.advisorName}\n${brand.displayName}`;
  return { subject, text: `${intro}\n\n${shareText(quote, url)}\n\n${signature}` };
}

export type EmailPreview = { ok: true; to: string; fromName: string; replyTo: string | null; subject: string; text: string; url: string } | { ok: false; error: string };

// What "Send by email" will send, for the dialog that shows it first (mockup 15): recipient,
// subject, message and link. Nothing is sent and the quote is not marked as sent; the client
// link is made now if the quote has none yet (it opens nothing until it is shared).
export async function emailPreview(actorUserId: string, agencyId: string, quoteId: string): Promise<EmailPreview> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: NOT_FOUND };
  if (quote.closedAt) return { ok: false, error: CLOSED };
  if (!quote.client?.email) return { ok: false, error: "The client has no email. Add one on the client's card, or send by WhatsApp." };
  const brand = quoteBrand(quote);
  let token = quote.shareToken;
  if (!token) {
    const made = randomBytes(24).toString("base64url");
    await db.$transaction(async (tx) => {
      const { count } = await tx.quote.updateMany({ where: { id: quote.id, agencyId, shareToken: null }, data: { shareToken: made } });
      if (count > 0) await audit(actorUserId, "quote.link.create", "Quote", quote.id, undefined, undefined, tx);
    });
    token = (await db.quote.findUniqueOrThrow({ where: { id: quote.id }, select: { shareToken: true } })).shareToken ?? made;
  }
  const url = shareUrl(token);
  const { subject, text } = emailContent(quote, brand, url);
  return { ok: true, to: quote.client.email, fromName: brand.displayName, replyTo: brand.replyTo, subject, text, url };
}

// ---------- the client page (public) ----------

export type ClientRoom = {
  id: string;
  roomName: string;
  bedDescription: string;
  amenities: string[]; // what the rate includes, as the supplier named it
  sellMinor: number;
  currency: string;
  // Free cancellation as the client is told it today: still open until a day, over since a day
  // (never shown as available again), or none. null when the quote shows no cancellation terms.
  cancel: CancelView | null;
  dueAtHotel: { minor: number; currency: string; localMinor: number | null; localCurrency: string | null } | null;
};

// What the client can do: choose ("open"), or only read: the offer ran out ("expired"), the agent
// closed the quote ("closed"), or every destination is booked ("booked").
export type ClientQuoteState = "open" | "expired" | "closed" | "booked";

export type ClientQuote = {
  number: number;
  code: string;
  title: string;
  message: string;
  language: "EN" | "HE";
  showCancellation: boolean;
  status: "SENT" | "VIEWED" | "SELECTED" | "BOOKED" | "DRAFT";
  state: ClientQuoteState;
  validLastDay: string | null; // "Prices valid until <date>": the offer's last whole day
  adults: number;
  childAges: number[];
  clientFirstName: string | null;
  clientNote: string;
  // Screen 20 branding: the display name, contact number and color, else the agency's own. The
  // number is in its international form (digits only) for the WhatsApp and call buttons; null
  // when the stored number cannot be turned into one (no buttons then).
  agency: { name: string; phoneE164: string | null; logoSha256: string | null; brandColor: string | null; contactEmail: string | null };
  agentName: string;
  stays: {
    id: string;
    destinationName: string;
    checkin: string;
    checkout: string;
    selectedRoomId: string | null;
    booked: boolean; // booked from the quote: the pick no longer changes
    confirmed: boolean; // that booking is confirmed by the hotel
    confirmedHotel: string | null; // the hotel of the confirmed booking, for the "Confirmed" box
    past: boolean; // the check-in day is not ahead any more: nothing can be chosen here
    hotels: { id: string; name: string; city: string; starRating: string | null; agencyPick: boolean; rooms: ClientRoom[] }[];
  }[];
};

function dueAtHotel(price: unknown): ClientRoom["dueAtHotel"] {
  const p = price as PriceBreakdown | null;
  const total = p?.dueAtPropertyTotal;
  if (!total || !Number.isSafeInteger(total.minor)) return null;
  const local = p?.dueAtProperty?.find((d) => d.localAmount)?.localAmount ?? null;
  const localSum = local ? (p?.dueAtProperty ?? []).reduce((n, d) => n + (d.localAmount?.minor ?? 0), 0) : null;
  return { minor: total.minor, currency: total.currency, localMinor: localSum, localCurrency: local?.currency ?? null };
}

export function validToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

// What the client page needs: the view (safe to send to the browser) and, for the server only,
// which supplier hotel each quote hotel is (to load photos). Supplier ids never reach the browser.
export type ClientQuoteData = { view: ClientQuote; propertyByHotel: Record<string, string> };

export async function clientQuote(token: string, now: Date = new Date()): Promise<ClientQuoteData | null> {
  if (!validToken(token)) return null;
  return loadClientQuote({ shareToken: token }, now);
}

// The same view for the agent's Preview: the agency's own quote, by id (no link needed).
export async function clientQuoteForAgency(agencyId: string, quoteId: string, now: Date = new Date()): Promise<ClientQuoteData | null> {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  return loadClientQuote({ id: quoteId, agencyId }, now);
}

// Opening the client page: one count per IP whatever the link, so a script cannot load page
// after page (each load reads the quote and its photos from the database).
export async function clientPageAllowed(ip: string): Promise<boolean> {
  const limit = ip === "unknown" ? PAGE_LIMIT.unknownLimit : PAGE_LIMIT.limit;
  return (await hitRateLimit(`quote-page:ip:${ipBucket(ip)}`, limit, PAGE_LIMIT.windowMs)).allowed;
}

function clientState(q: { status: ClientQuote["status"]; closedAt: Date | null; validUntil: Date | null; stays: { checkin: string }[] }, now: Date): ClientQuoteState {
  if (q.closedAt) return "closed";
  if (q.status === "BOOKED") return "booked";
  if (offerOver(q.validUntil, now)) return "expired";
  const today = todayIso(now);
  return q.stays.length > 0 && q.stays.every((s) => !dayAhead(s.checkin, today)) ? "expired" : "open";
}

async function loadClientQuote(where: { shareToken: string } | { id: string; agencyId: string }, now: Date): Promise<ClientQuoteData | null> {
  const q = await db.quote.findFirst({
    where,
    select: {
      number: true,
      agencyNumber: true,
      title: true,
      message: true,
      language: true,
      showCancellation: true,
      status: true,
      adults: true,
      childAges: true,
      clientNote: true,
      markupType: true,
      markupValue: true,
      validUntil: true,
      closedAt: true,
      client: { select: { firstName: true } },
      agency: {
        select: {
          name: true,
          phone: true,
          email: true,
          country: true,
          status: true,
          quoteAdvisorEmail: true,
          quoteDisplayName: true,
          quoteContactPhone: true,
          quoteAdvisorName: true,
          quoteBrandColor: true,
          logo: { select: { sha256: true } },
        },
      },
      createdBy: { select: { name: true } },
      stays: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          destinationName: true,
          checkin: true,
          checkout: true,
          selectedRoomId: true,
          bookings: { where: { status: { in: ACTIVE_BOOKING } }, orderBy: { createdAt: "desc" }, select: { status: true, hotelName: true } },
          hotels: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              propertyId: true,
              name: true,
              city: true,
              starRating: true,
              agencyPick: true,
              rooms: {
                orderBy: { position: "asc" },
                select: { id: true, roomName: true, bedDescription: true, amenities: true, netMinor: true, sellMinor: true, currency: true, refundable: true, freeCancelUntil: true, clientCancelUntil: true, price: true },
              },
            },
          },
        },
      },
    },
  });
  // A suspended agency's links stop working.
  if (!q || q.agency.status !== "ACTIVE") return null;
  const today = todayIso(now);
  const number = q.agencyNumber ?? q.number;
  const phone = q.agency.quoteContactPhone ?? q.agency.phone;
  const propertyByHotel = Object.fromEntries(q.stays.flatMap((s) => s.hotels.map((h) => [h.id, h.propertyId])));
  const view: ClientQuote = {
    number,
    code: quoteCode(number),
    title: q.title,
    message: q.message,
    language: q.language,
    showCancellation: q.showCancellation,
    status: q.status,
    state: clientState(q, now),
    validLastDay: q.validUntil ? offerLastDay(q.validUntil) : null,
    adults: q.adults,
    childAges: q.childAges,
    clientFirstName: q.client?.firstName ?? null,
    clientNote: q.clientNote,
    agency: {
      name: q.agency.quoteDisplayName ?? q.agency.name,
      phoneE164: phone ? toE164Digits(phone, q.agency.country) : null,
      logoSha256: q.agency.logo?.sha256 ?? null,
      // Stored only as #rrggbb (checked on save); checked again before it reaches a style.
      brandColor: q.agency.quoteBrandColor && /^#[0-9a-f]{6}$/.test(q.agency.quoteBrandColor) ? q.agency.quoteBrandColor : null,
      // Where the client's replies go (the advisor email of screen 20, else the agency's).
      contactEmail: q.agency.quoteAdvisorEmail ?? q.agency.email ?? null,
    },
    agentName: q.agency.quoteAdvisorName ?? q.createdBy.name,
    stays: q.stays.map((stay) => ({
      id: stay.id,
      destinationName: stay.destinationName,
      checkin: stay.checkin,
      checkout: stay.checkout,
      selectedRoomId: stay.selectedRoomId,
      booked: stay.bookings.length > 0,
      confirmed: stay.bookings.some((b) => b.status === "CONFIRMED"),
      confirmedHotel: stay.bookings.find((b) => b.status === "CONFIRMED")?.hotelName ?? null,
      past: !dayAhead(stay.checkin, today),
      hotels: stay.hotels
        .filter((h) => h.rooms.length > 0)
        .map((h) => ({
          id: h.id,
          name: h.name,
          city: h.city,
          starRating: h.starRating?.toString() ?? null,
          agencyPick: h.agencyPick,
          rooms: h.rooms.map((r) => ({
            id: r.id,
            roomName: r.roomName,
            bedDescription: r.bedDescription,
            amenities: r.amenities,
            sellMinor: sellingMinor(r, q),
            currency: r.currency,
            cancel: q.showCancellation ? clientCancelView(r, today) : null,
            dueAtHotel: dueAtHotel(r.price),
          })),
        })),
    })),
  };
  return { view, propertyByHotel };
}

// The page's title for the browser tab and link previews: the agency (as the client knows it)
// and the quote's name, never Apolles. null for a link that opens nothing.
export async function clientQuoteMeta(token: string): Promise<{ agencyName: string; title: string; language: "EN" | "HE" } | null> {
  if (!validToken(token)) return null;
  const q = await db.quote.findUnique({
    where: { shareToken: token },
    select: { title: true, language: true, agency: { select: { name: true, status: true, quoteDisplayName: true } } },
  });
  if (!q || q.agency.status !== "ACTIVE") return null;
  return { agencyName: q.agency.quoteDisplayName ?? q.agency.name, title: q.title, language: q.language };
}

// The agency logo for the client page, by the quote's token.
export async function clientLogo(token: string) {
  if (!validToken(token)) return null;
  const q = await db.quote.findUnique({ where: { shareToken: token }, select: { agency: { select: { status: true, logo: true } } } });
  return q && q.agency.status === "ACTIVE" ? q.agency.logo : null;
}

// Called by the page in the browser (so link previews and bots do not count as a view).
// `viewerAgencyId`: the agency of the agent signed in on this browser, if any. The agency's own
// people opening the link (to check it before sending) are not the client: nothing is counted.
// A view never changes the quote's place in the agent's list (that follows the agent's edits).
export async function recordView(token: string, ip: string, viewerAgencyId?: string | null): Promise<void> {
  if (!validToken(token)) return;
  const { allowed } = await hitRateLimit(`quote-view:ip:${ipBucket(ip)}`, VIEW_LIMIT.limit, VIEW_LIMIT.windowMs);
  if (!allowed) return;
  await db.$transaction(async (tx) => {
    // Locked by the token itself: a link withdrawn meanwhile (new link, other client) finds nothing.
    const [q] = await tx.$queryRaw<{ id: string; agencyId: string }[]>`SELECT id, "agencyId" FROM "Quote" WHERE "shareToken" = ${token} FOR UPDATE`;
    if (!q || (viewerAgencyId && q.agencyId === viewerAgencyId)) return;
    await tx.quote.update({ where: { id: q.id }, data: { viewCount: { increment: 1 }, viewedAt: new Date() } });
    await tx.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "VIEWED" } });
  });
}

const selectionInput = z
  .object({
    picks: z.record(z.string().max(64), z.string().max(64)).refine((v) => Object.keys(v).length <= 20),
    // The price the page showed for each picked room (cents), only ever compared with the price
    // on the server: a choice made on a page that is out of date is not recorded.
    seen: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000_000)).refine((v) => Object.keys(v).length <= 20),
    note: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(z.string().trim().max(1000).refine((value) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(value))),
  })
  .strict();

// "prices": a price the client saw is not the price now. "updated": a room or destination the
// client chose is no longer in the offer. Both: nothing was recorded, the page shows the offer
// again and keeps the choices that still stand. "expired" / "closed" / "locked": read-only.
export type SelectionResult = { ok: true } | { ok: false; error: "invalid" | "locked" | "limited" | "gone" | "prices" | "updated" | "expired" | "closed" };

export type SelectionInput = { picks: Record<string, string>; seen?: Record<string, number>; note: string };

// The client's choice: at most one room per destination (or none), and an optional note. Every
// room must belong to its destination in this quote. A booked, closed or expired quote can no
// longer change; a booked destination keeps its pick while the others stay open.
export async function submitSelection(token: string, raw: SelectionInput, ip: string, now: Date = new Date()): Promise<SelectionResult> {
  if (!validToken(token)) return { ok: false, error: "gone" };
  const parsed = selectionInput.safeParse({ picks: raw.picks, seen: raw.seen ?? {}, note: raw.note });
  if (!parsed.success) return { ok: false, error: "invalid" };
  // Per IP whatever the link, counted before anything is looked up.
  const perIpAll = await hitRateLimit(`quote-select:ip:${ipBucket(ip)}`, ip === "unknown" ? SELECT_IP_LIMIT.unknownLimit : SELECT_IP_LIMIT.limit, SELECT_IP_LIMIT.windowMs);
  if (!perIpAll.allowed) return { ok: false, error: "limited" };
  // Only a link that exists gets counters of its own: made-up tokens write nothing more.
  const exists = await db.quote.findUnique({ where: { shareToken: token }, select: { id: true } });
  if (!exists) return { ok: false, error: "gone" };
  // Per IP (when known) and per quote, so neither a changing IP nor a shared one gets around it.
  if (ip !== "unknown") {
    const perIp = await hitRateLimit(`quote-select:${ipBucket(ip)}:${token.slice(0, 12)}`, SELECT_LIMIT.limit, SELECT_LIMIT.windowMs);
    if (!perIp.allowed) return { ok: false, error: "limited" };
  }
  const perQuote = await hitRateLimit(`quote-select:quote:${token.slice(0, 16)}`, SELECT_QUOTE_LIMIT.limit, SELECT_QUOTE_LIMIT.windowMs);
  if (!perQuote.allowed) return { ok: false, error: "limited" };

  const { picks, seen, note } = parsed.data;
  const result = await db.$transaction(async (tx) => {
    // Locked by the token itself, so a link withdrawn while this waited (new link, other client)
    // finds nothing: Postgres checks the token again once the lock is free.
    const [found] = await tx.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM "Quote" q JOIN "Agency" a ON a.id = q."agencyId"
      WHERE q."shareToken" = ${token} AND a.status = 'ACTIVE' FOR UPDATE OF q`;
    if (!found) return { ok: false, error: "gone" } as const;
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: found.id },
      select: {
        id: true,
        agencyId: true,
        status: true,
        createdById: true,
        clientNote: true,
        markupType: true,
        markupValue: true,
        validUntil: true,
        closedAt: true,
        stays: {
          select: {
            id: true,
            checkin: true,
            selectedRoomId: true,
            hotels: { select: { rooms: { select: { id: true, netMinor: true, sellMinor: true, currency: true } } } },
            bookings: { where: { status: { in: ACTIVE_BOOKING } }, select: { id: true }, take: 1 },
          },
        },
      },
    });
    const state = clientState(quote, now);
    if (state === "booked") return { ok: false, error: "locked" } as const;
    if (state !== "open") return { ok: false, error: state } as const;
    const today = todayIso(now);
    const stays = new Map(quote.stays.map((s) => [s.id, new Map(s.hotels.flatMap((h) => h.rooms.map((r) => [r.id, r] as const)))]));
    // A destination or a room that is no longer in the offer: the page is out of date.
    for (const [stayId, roomId] of Object.entries(picks)) {
      if (roomId && !stays.get(stayId)?.has(roomId)) return { ok: false, error: "updated" } as const;
    }
    for (const stay of quote.stays) {
      const roomId = picks[stay.id] || null;
      const same = roomId === stay.selectedRoomId;
      // A destination already booked keeps its pick (plan 5d): the client cannot change it.
      if (stay.bookings.length > 0) {
        if (!same) return { ok: false, error: "locked" } as const;
        continue;
      }
      // A destination whose check-in day is not ahead any more takes no new choice.
      if (!dayAhead(stay.checkin, today) && !same) return { ok: false, error: "updated" } as const;
      // The price the client saw for the room they chose must be the price now.
      const room = roomId ? stays.get(stay.id)?.get(roomId) : undefined;
      if (room && seen[room.id] !== sellingMinor(room, quote)) return { ok: false, error: "prices" } as const;
    }
    const changed = quote.clientNote !== note || quote.stays.some((s) => (s.selectedRoomId ?? "") !== (picks[s.id] ?? ""));
    for (const stay of quote.stays) {
      if (stay.bookings.length > 0) continue; // frozen with its booking, price included
      const roomId = picks[stay.id] || null;
      const room = roomId ? stays.get(stay.id)?.get(roomId) : undefined;
      // The selling price the client saw (checked above), kept with the choice.
      await tx.quoteStay.update({
        where: { id: stay.id },
        data: { selectedRoomId: roomId, selectedSellMinor: room ? sellingMinor(room, quote) : null, selectedCurrency: room?.currency ?? null, selectedByAgent: false },
      });
    }
    const anyPick = Object.values(picks).some(Boolean);
    await tx.quote.update({
      where: { id: quote.id },
      data: {
        clientNote: note,
        selectedAt: new Date(),
        status: anyPick ? "SELECTED" : quote.status === "SELECTED" ? "VIEWED" : quote.status === "DRAFT" ? "DRAFT" : "VIEWED",
        // "New selection" (or "New message") on the agent's list until the agent opens the quote.
        ...(changed ? { selectionUnseen: true } : {}),
      },
    });
    // The destinations that still have rooms may all be booked already: the quote is then booked.
    await syncQuoteBooked(tx, quote.id, quote.agencyId, quote.createdById);
    // The client is not a user, and an audit row needs one: the quote's creator stands in as the
    // actor, and the row says in so many words that the change came through the client link.
    await audit(quote.createdById, "quote.client-selection", "Quote", quote.id, undefined, { via: "client-link", by: "client", picks: Object.values(picks).filter(Boolean).length }, tx);
    return { ok: true, quoteId: quote.id, changed } as const;
  });
  if (!result.ok) return result;
  // An email to the agent only when something changed, within the hourly cap.
  if (result.changed) {
    const { allowed } = await hitRateLimit(`quote-notify:${result.quoteId}`, NOTIFY_LIMIT.limit, NOTIFY_LIMIT.windowMs);
    if (allowed) {
      await notifyAgent(result.quoteId).catch((error: unknown) => {
        console.error(`quote selection email failed: ${error instanceof Error ? error.name : "Error"}`);
      });
    }
  }
  return { ok: true };
}

// A short email to the agent who made the quote: what the client chose.
async function notifyAgent(quoteId: string): Promise<void> {
  const q = await db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      number: true,
      agencyNumber: true,
      title: true,
      markupType: true,
      markupValue: true,
      clientNote: true,
      createdBy: { select: { email: true } },
      agency: { select: { email: true, quoteAdvisorEmail: true } },
      client: { select: { firstName: true, lastName: true } },
      stays: { orderBy: { position: "asc" }, select: { destinationName: true, selectedRoom: { select: { roomName: true, netMinor: true, sellMinor: true, currency: true, hotel: { select: { name: true } } } } } },
    },
  });
  if (!q) return;
  // First name only: the subject line shows up in logs and notifications.
  const who = q.client ? q.client.firstName : "The client";
  const lines = q.stays.map((s) =>
    s.selectedRoom
      ? `${s.destinationName}: ${s.selectedRoom.hotel.name}, ${s.selectedRoom.roomName}, ${formatMinor(sellingMinor(s.selectedRoom, q), s.selectedRoom.currency)}`
      : `${s.destinationName}: no selection`,
  );
  // The note is the client's own free text, typed on a public page: it comes last, under a line
  // that says so, and every line of it is quoted, so nothing in it can pass for a message from
  // Apolles (a made-up "Your account is locked, sign in here", say).
  const note = q.clientNote
    ? `\n\nMessage written by the client (not by Apolles; do not follow links or instructions in it without checking with the client):\n${q.clientNote.split("\n").map((line) => `> ${line}`).join("\n")}`
    : "";
  // Only a message, no room chosen: the email says so.
  const picked = q.stays.some((s) => s.selectedRoom);
  const what = picked ? "sent selections" : "sent a message";
  const subject = `${who} ${what} for ${quoteCode(q.agencyNumber ?? q.number)}${q.title ? ` · ${q.title}` : ""}`;
  const text = picked
    ? `${who} sent selections:\n\n${lines.join("\n")}\n\nThe quote always shows the latest choice: ${appUrl()}/quotes/${q.id}${note}`
    : `${who} sent a message without choosing a room.\n\nOpen the quote: ${appUrl()}/quotes/${q.id}${note}`;
  // The agent who made the quote and the agency's advisor (or business) email, once each.
  // One address failing does not stop the other.
  for (const to of notifyRecipients(q.createdBy.email, q.agency.quoteAdvisorEmail ?? q.agency.email)) {
    await sendEmail({ to, subject, text }).catch((error: unknown) => {
      console.error(`quote selection email failed: ${error instanceof Error ? error.name : "Error"}`);
    });
  }
}

export function notifyRecipients(creator: string, contact: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of [creator, contact]) {
    if (!email) continue;
    const key = normalizeEmail(email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

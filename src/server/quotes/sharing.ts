import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import { formatMinor } from "@/lib/supplier-money";
import { sellingMinor } from "@/server/quotes/pricing";
import { quoteCode } from "@/server/quotes/quotes";
import { hitRateLimit } from "@/server/rate-limit";
import type { PriceBreakdown } from "@/server/supplier/types";

// Sharing a quote with the client (screens 15, 16, 17; plan 5c). The client link holds an
// unguessable token (24 random bytes). It opens one quote read-only for the client, who can send
// selections; it never signs anyone in. Agent functions take the agencyId from the session; the
// public functions find the quote only by its token, and show the agency's selling prices only:
// never the net, the markup or anything of the supplier's.

export type ShareResult = { ok: true; url: string } | { ok: false; error: string };

const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const EMAIL_LIMIT = { limit: 30, windowMs: 60 * 60_000 }; // per agency
const VIEW_LIMIT = { limit: 120, windowMs: 60_000 }; // per IP
const SELECT_LIMIT = { limit: 20, windowMs: 60 * 60_000 }; // per IP and quote
const SELECT_QUOTE_LIMIT = { limit: 40, windowMs: 24 * 60 * 60_000 }; // per quote, whatever the IP
// Emails to the agent per quote: one for each real change, up to 6 an hour (the editor always shows
// the latest choice, and the email says so).
const NOTIFY_LIMIT = { limit: 6, windowMs: 60 * 60_000 };

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
      client: { select: { firstName: true, email: true, phone: true } },
      agency: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
}

// Who the client sees as the sender: the agency's name and the agent's name. Replies go to the
// agency's business email, or else the agent's login email.
function quoteBrand(quote: { agency: { name: string; email: string | null }; createdBy: { name: string; email: string } }) {
  return { displayName: quote.agency.name, advisorName: quote.createdBy.name, replyTo: quote.agency.email ?? quote.createdBy.email };
}

// The client link of the agency's quote, made on first use. Sharing marks a draft as sent.
export async function shareLink(
  actorUserId: string,
  agencyId: string,
  quoteId: string,
  channel: "link" | "whatsapp" | "email",
  options: { markSent?: boolean } = {},
): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: "This quote was not found." };
  const token = quote.shareToken ?? randomBytes(24).toString("base64url");
  await db.$transaction(async (tx) => {
    // updateMany with the old token: two clicks at once never make two different links.
    await tx.quote.updateMany({ where: { id: quote.id, agencyId, shareToken: null }, data: { shareToken: token } });
    if (options.markSent !== false) await markSent(tx, quote.id);
    await audit(actorUserId, "quote.share", "Quote", quote.id, undefined, { channel }, tx);
  });
  const saved = await db.quote.findUniqueOrThrow({ where: { id: quote.id }, select: { shareToken: true } });
  return { ok: true, url: shareUrl(saved.shareToken ?? token) };
}

// "New link": the old client link stops working at once (a link sent to the wrong person, say).
export async function renewLink(actorUserId: string, agencyId: string, quoteId: string): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: "This quote was not found." };
  const token = randomBytes(24).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.quote.updateMany({ where: { id: quote.id, agencyId }, data: { shareToken: token } });
    await audit(actorUserId, "quote.share.renew", "Quote", quote.id, undefined, undefined, tx);
  });
  return { ok: true, url: shareUrl(token) };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function markSent(tx: Tx, quoteId: string): Promise<void> {
  await tx.quote.updateMany({ where: { id: quoteId, status: "DRAFT" }, data: { status: "SENT" } });
  await tx.quote.update({ where: { id: quoteId }, data: { sentAt: new Date() } });
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

// wa.me opens the agent's own WhatsApp with the text ready; nothing is sent by Apolles.
export function whatsappUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^00/, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export async function whatsappLink(actorUserId: string, agencyId: string, quoteId: string): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: "This quote was not found." };
  if (!quote.client) return { ok: false, error: "Choose the client first." };
  const shared = await shareLink(actorUserId, agencyId, quoteId, "whatsapp");
  if (!shared.ok) return shared;
  return { ok: true, url: whatsappUrl(quote.client.phone, shareText(quote, shared.url)) };
}

// Apolles emails the client the link, in the agency's name. Limited to 30 an hour per agency.
export async function emailQuote(actorUserId: string, agencyId: string, quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: "This quote was not found." };
  if (!quote.client?.email) return { ok: false, error: "The client has no email. Add one on the client's card, or send by WhatsApp." };
  const { allowed } = await hitRateLimit(`quote-email:agency:${agencyId}`, EMAIL_LIMIT.limit, EMAIL_LIMIT.windowMs);
  if (!allowed) return { ok: false, error: "Too many emails this hour. Try again later, or send by WhatsApp." };
  const shared = await shareLink(actorUserId, agencyId, quoteId, "email", { markSent: false });
  if (!shared.ok) return shared;
  const subject =
    quote.language === "HE"
      ? `${quote.title || "הצעת נסיעה"} · ${quote.agency.name}`
      : `${quote.title || "Your travel proposal"} · ${quote.agency.name}`;
  const brand = quoteBrand(quote);
  const signature = `${brand.advisorName}\n${brand.displayName}`;
  try {
    await sendEmail({
      to: quote.client.email,
      subject,
      text: `${shareText(quote, shared.url)}\n\n${signature}`,
      fromName: brand.displayName,
      ...(brand.replyTo ? { replyTo: brand.replyTo } : {}),
    });
  } catch (error) {
    // Logged by name only (never the address or the body); the quote stays as it was.
    console.error(`quote email failed: ${error instanceof Error ? error.name : "Error"}`);
    return { ok: false, error: "The email could not be sent right now. Try again in a few minutes, or send by WhatsApp." };
  }
  await db.$transaction(async (tx) => {
    await markSent(tx, quote.id);
    await audit(actorUserId, "quote.email", "Quote", quote.id, undefined, { channel: "email" }, tx);
  });
  return { ok: true };
}

// ---------- the client page (public) ----------

export type ClientRoom = {
  id: string;
  roomName: string;
  bedDescription: string;
  sellMinor: number;
  currency: string;
  freeUntil: string | null; // shown only when the quote shows cancellation terms
  refundable: boolean;
  dueAtHotel: { minor: number; currency: string; localMinor: number | null; localCurrency: string | null } | null;
};

export type ClientQuote = {
  number: number;
  code: string;
  title: string;
  message: string;
  language: "EN" | "HE";
  showCancellation: boolean;
  status: "SENT" | "VIEWED" | "SELECTED" | "BOOKED" | "DRAFT";
  adults: number;
  childAges: number[];
  clientFirstName: string | null;
  clientNote: string;
  agency: { name: string; phone: string | null; logoSha256: string | null };
  agentName: string;
  stays: {
    id: string;
    destinationName: string;
    checkin: string;
    checkout: string;
    selectedRoomId: string | null;
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

export async function clientQuote(token: string): Promise<ClientQuoteData | null> {
  if (!validToken(token)) return null;
  return loadClientQuote({ shareToken: token });
}

// The same view for the agent's Preview: the agency's own quote, by id (no link needed).
export async function clientQuoteForAgency(agencyId: string, quoteId: string): Promise<ClientQuoteData | null> {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  return loadClientQuote({ id: quoteId, agencyId });
}

async function loadClientQuote(where: { shareToken: string } | { id: string; agencyId: string }): Promise<ClientQuoteData | null> {
  const q = await db.quote.findFirst({
    where,
    select: {
      number: true,
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
      client: { select: { firstName: true } },
      agency: { select: { name: true, phone: true, email: true, status: true, logo: { select: { sha256: true } } } },
      createdBy: { select: { name: true } },
      stays: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          destinationName: true,
          checkin: true,
          checkout: true,
          selectedRoomId: true,
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
                select: { id: true, roomName: true, bedDescription: true, netMinor: true, sellMinor: true, currency: true, refundable: true, clientCancelUntil: true, price: true },
              },
            },
          },
        },
      },
    },
  });
  // A suspended agency's links stop working.
  if (!q || q.agency.status !== "ACTIVE") return null;
  const propertyByHotel = Object.fromEntries(q.stays.flatMap((s) => s.hotels.map((h) => [h.id, h.propertyId])));
  const view: ClientQuote = {
    number: q.number,
    code: quoteCode(q.number),
    title: q.title,
    message: q.message,
    language: q.language,
    showCancellation: q.showCancellation,
    status: q.status,
    adults: q.adults,
    childAges: q.childAges,
    clientFirstName: q.client?.firstName ?? null,
    clientNote: q.clientNote,
    agency: { name: q.agency.name, phone: q.agency.phone, logoSha256: q.agency.logo?.sha256 ?? null },
    agentName: q.createdBy.name,
    stays: q.stays.map((stay) => ({
      id: stay.id,
      destinationName: stay.destinationName,
      checkin: stay.checkin,
      checkout: stay.checkout,
      selectedRoomId: stay.selectedRoomId,
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
            sellMinor: sellingMinor(r, q),
            currency: r.currency,
            refundable: r.refundable,
            freeUntil: q.showCancellation && r.refundable ? r.clientCancelUntil : null,
            dueAtHotel: dueAtHotel(r.price),
          })),
        })),
    })),
  };
  return { view, propertyByHotel };
}

// The agency logo for the client page, by the quote's token.
export async function clientLogo(token: string) {
  if (!validToken(token)) return null;
  const q = await db.quote.findUnique({ where: { shareToken: token }, select: { agency: { select: { status: true, logo: true } } } });
  return q && q.agency.status === "ACTIVE" ? q.agency.logo : null;
}

// Called by the page in the browser (so link previews and bots do not count as a view).
export async function recordView(token: string, ip: string): Promise<void> {
  if (!validToken(token)) return;
  const { allowed } = await hitRateLimit(`quote-view:ip:${ip}`, VIEW_LIMIT.limit, VIEW_LIMIT.windowMs);
  if (!allowed) return;
  await db.$transaction(async (tx) => {
    // Locked by the token itself: a link withdrawn meanwhile (new link, other client) finds nothing.
    const [q] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Quote" WHERE "shareToken" = ${token} FOR UPDATE`;
    if (!q) return;
    await tx.quote.update({ where: { id: q.id }, data: { viewCount: { increment: 1 }, viewedAt: new Date() } });
    await tx.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "VIEWED" } });
  });
}

const selectionInput = z
  .object({
    picks: z.record(z.string().max(64), z.string().max(64)).refine((v) => Object.keys(v).length <= 20),
    note: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .pipe(z.string().trim().max(1000).refine((value) => !/[\p{Cf}\u0000-\u0009\u000B-\u001F\u007F]/u.test(value))),
  })
  .strict();

export type SelectionResult = { ok: true } | { ok: false; error: "invalid" | "locked" | "limited" | "gone" };

// The client's choice: at most one room per destination (or none), and an optional note. Every
// room must belong to its destination in this quote. A booked quote can no longer change.
export async function submitSelection(token: string, raw: { picks: Record<string, string>; note: string }, ip: string): Promise<SelectionResult> {
  if (!validToken(token)) return { ok: false, error: "gone" };
  const parsed = selectionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // Per IP (when known) and per quote, so neither a changing IP nor a shared one gets around it.
  if (ip !== "unknown") {
    const perIp = await hitRateLimit(`quote-select:${ip}:${token.slice(0, 12)}`, SELECT_LIMIT.limit, SELECT_LIMIT.windowMs);
    if (!perIp.allowed) return { ok: false, error: "limited" };
  }
  const perQuote = await hitRateLimit(`quote-select:quote:${token.slice(0, 16)}`, SELECT_QUOTE_LIMIT.limit, SELECT_QUOTE_LIMIT.windowMs);
  if (!perQuote.allowed) return { ok: false, error: "limited" };

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
        status: true,
        createdById: true,
        clientNote: true,
        markupType: true,
        markupValue: true,
        stays: {
          select: { id: true, selectedRoomId: true, hotels: { select: { rooms: { select: { id: true, netMinor: true, sellMinor: true, currency: true } } } } },
        },
      },
    });
    if (quote.status === "BOOKED") return { ok: false, error: "locked" } as const;
    const stays = new Map(quote.stays.map((s) => [s.id, new Map(s.hotels.flatMap((h) => h.rooms.map((r) => [r.id, r] as const)))]));
    for (const [stayId, roomId] of Object.entries(parsed.data.picks)) {
      if (roomId && !stays.get(stayId)?.has(roomId)) return { ok: false, error: "invalid" } as const;
    }
    const changed =
      quote.clientNote !== parsed.data.note || quote.stays.some((s) => (s.selectedRoomId ?? "") !== (parsed.data.picks[s.id] ?? ""));
    for (const [stayId, rooms] of stays) {
      const roomId = parsed.data.picks[stayId] || null;
      const room = roomId ? rooms.get(roomId) : undefined;
      // The selling price the client saw, kept with the choice.
      await tx.quoteStay.update({
        where: { id: stayId },
        data: { selectedRoomId: roomId, selectedSellMinor: room ? sellingMinor(room, quote) : null, selectedCurrency: room?.currency ?? null },
      });
    }
    const anyPick = Object.values(parsed.data.picks).some(Boolean);
    await tx.quote.update({
      where: { id: quote.id },
      data: { clientNote: parsed.data.note, selectedAt: new Date(), status: anyPick ? "SELECTED" : quote.status === "SELECTED" ? "VIEWED" : quote.status === "DRAFT" ? "DRAFT" : "VIEWED" },
    });
    // The client is not a user: the quote's creator is recorded as the actor, with the reason.
    await audit(quote.createdById, "quote.client-selection", "Quote", quote.id, undefined, { picks: Object.values(parsed.data.picks).filter(Boolean).length }, tx);
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
      title: true,
      markupType: true,
      markupValue: true,
      clientNote: true,
      createdBy: { select: { email: true } },
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
  await sendEmail({
    to: q.createdBy.email,
    subject: `${who} sent selections for ${quoteCode(q.number)}${q.title ? ` · ${q.title}` : ""}`,
    text: `${who} sent selections:\n\n${lines.join("\n")}${q.clientNote ? `\n\nNote: ${q.clientNote}` : ""}\n\nThe quote always shows the latest choice: ${appUrl()}/quotes/${q.id}`,
  });
}

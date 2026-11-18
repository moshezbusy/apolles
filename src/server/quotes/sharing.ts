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
      agency: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
}

// The client link of the agency's quote, made on first use. Sharing marks a draft as sent.
export async function shareLink(actorUserId: string, agencyId: string, quoteId: string, channel: "link" | "whatsapp"): Promise<ShareResult> {
  const quote = await ownQuote(agencyId, quoteId);
  if (!quote) return { ok: false, error: "This quote was not found." };
  const token = quote.shareToken ?? randomBytes(24).toString("base64url");
  await db.$transaction(async (tx) => {
    // updateMany with the old token: two clicks at once never make two different links.
    await tx.quote.updateMany({ where: { id: quote.id, agencyId, shareToken: null }, data: { shareToken: token } });
    await markSent(tx, quote.id);
    await audit(actorUserId, "quote.share", "Quote", quote.id, undefined, { channel }, tx);
  });
  const saved = await db.quote.findUniqueOrThrow({ where: { id: quote.id }, select: { shareToken: true } });
  return { ok: true, url: shareUrl(saved.shareToken ?? token) };
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
  const shared = await shareLink(actorUserId, agencyId, quoteId, "link");
  if (!shared.ok) return shared;
  const subject =
    quote.language === "HE"
      ? `${quote.title || "הצעת נסיעה"} · ${quote.agency.name}`
      : `${quote.title || "Your travel proposal"} · ${quote.agency.name}`;
  const signature = `${quote.createdBy.name}\n${quote.agency.name}`;
  await sendEmail({ to: quote.client.email, subject, text: `${shareText(quote, shared.url)}\n\n${signature}` });
  await audit(actorUserId, "quote.email", "Quote", quote.id, undefined, { channel: "email" });
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
  agency: { name: string; phone: string | null; email: string | null; logoSha256: string | null };
  agentName: string;
  stays: {
    id: string;
    destinationName: string;
    checkin: string;
    checkout: string;
    selectedRoomId: string | null;
    hotels: { id: string; propertyId: string; name: string; city: string; starRating: string | null; agencyPick: boolean; rooms: ClientRoom[] }[];
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

export async function clientQuote(token: string): Promise<ClientQuote | null> {
  if (!validToken(token)) return null;
  return loadClientQuote({ shareToken: token });
}

// The same view for the agent's Preview: the agency's own quote, by id (no link needed).
export async function clientQuoteForAgency(agencyId: string, quoteId: string): Promise<ClientQuote | null> {
  if (typeof quoteId !== "string" || quoteId.length > 64) return null;
  return loadClientQuote({ id: quoteId, agencyId });
}

async function loadClientQuote(where: { shareToken: string } | { id: string; agencyId: string }): Promise<ClientQuote | null> {
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
  return {
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
    agency: { name: q.agency.name, phone: q.agency.phone, email: q.agency.email, logoSha256: q.agency.logo?.sha256 ?? null },
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
          propertyId: h.propertyId,
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
    const q = await tx.quote.findUnique({ where: { shareToken: token }, select: { id: true } });
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
  const { allowed } = await hitRateLimit(`quote-select:${ip}:${token.slice(0, 12)}`, SELECT_LIMIT.limit, SELECT_LIMIT.windowMs);
  if (!allowed) return { ok: false, error: "limited" };

  const result = await db.$transaction(async (tx) => {
    const found = await tx.quote.findUnique({ where: { shareToken: token }, select: { id: true, agency: { select: { status: true } } } });
    if (!found || found.agency.status !== "ACTIVE") return { ok: false, error: "gone" } as const;
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${found.id} FOR UPDATE`;
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: found.id },
      select: { id: true, status: true, createdById: true, stays: { select: { id: true, hotels: { select: { rooms: { select: { id: true } } } } } } },
    });
    if (quote.status === "BOOKED") return { ok: false, error: "locked" } as const;
    const stays = new Map(quote.stays.map((s) => [s.id, new Set(s.hotels.flatMap((h) => h.rooms.map((r) => r.id)))]));
    for (const [stayId, roomId] of Object.entries(parsed.data.picks)) {
      if (roomId && !stays.get(stayId)?.has(roomId)) return { ok: false, error: "invalid" } as const;
    }
    for (const stayId of stays.keys()) {
      const roomId = parsed.data.picks[stayId] || null;
      await tx.quoteStay.update({ where: { id: stayId }, data: { selectedRoomId: roomId } });
    }
    const anyPick = Object.values(parsed.data.picks).some(Boolean);
    await tx.quote.update({
      where: { id: quote.id },
      data: { clientNote: parsed.data.note, selectedAt: new Date(), status: anyPick ? "SELECTED" : quote.status === "SELECTED" ? "VIEWED" : quote.status === "DRAFT" ? "DRAFT" : "VIEWED" },
    });
    // The client is not a user: the quote's creator is recorded as the actor, with the reason.
    await audit(quote.createdById, "quote.client-selection", "Quote", quote.id, undefined, { picks: Object.values(parsed.data.picks).filter(Boolean).length }, tx);
    return { ok: true, quoteId: quote.id } as const;
  });
  if (!result.ok) return result;
  await notifyAgent(result.quoteId).catch((error: unknown) => {
    console.error(`quote selection email failed: ${error instanceof Error ? error.name : "Error"}`);
  });
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
  const who = q.client ? `${q.client.firstName} ${q.client.lastName}` : "The client";
  const lines = q.stays.map((s) =>
    s.selectedRoom
      ? `${s.destinationName}: ${s.selectedRoom.hotel.name}, ${s.selectedRoom.roomName}, ${formatMinor(sellingMinor(s.selectedRoom, q), s.selectedRoom.currency)}`
      : `${s.destinationName}: no selection`,
  );
  await sendEmail({
    to: q.createdBy.email,
    subject: `${who} sent selections for ${quoteCode(q.number)}${q.title ? ` · ${q.title}` : ""}`,
    text: `${who} sent selections:\n\n${lines.join("\n")}${q.clientNote ? `\n\nNote: ${q.clientNote}` : ""}\n\nOpen the quote: ${appUrl()}/quotes/${q.id}`,
  });
}

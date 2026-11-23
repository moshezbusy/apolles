import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { currencyExponent } from "@/lib/supplier-money";
import { db } from "@/server/db";

// The agency's bookings list (screen 13) and its CSV export. Always scoped by agencyId.
// Drafts are not bookings: only the "Not finished" tab lists them (guest details entered, not
// booked yet, so the agent can find one again after topping up); expired drafts never.

export type BookingTab = "all" | "upcoming" | "in_stay" | "completed" | "pending" | "failed" | "cancelled" | "not_finished";
export const BOOKING_TABS: readonly BookingTab[] = ["all", "upcoming", "in_stay", "completed", "pending", "failed", "cancelled", "not_finished"];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  DRAFT: "Draft",
  PENDING_CONFIRMATION: "Waiting for the hotel",
  CONFIRMED: "Confirmed",
  FAILED: "Not confirmed",
  CANCEL_PENDING: "Cancellation pending",
  CANCELLED: "Cancelled",
  CANCELLED_BY_SUPPLIER: "Cancelled by the hotel",
  EXPIRED: "Expired",
};

const LISTED: BookingStatus[] = ["PENDING_CONFIRMATION", "CONFIRMED", "FAILED", "CANCEL_PENDING", "CANCELLED", "CANCELLED_BY_SUPPLIER"];
const DEFAULT_TAKE = 20;
const MAX_TAKE = 200; // "Load more" shows the first 20, 40, ... up to 200 rows on one page
const CSV_MAX_ROWS = 5_000;
const UTF8_BOM = "\uFEFF";

// Booked between two days (UTC, both included) and check-in between two days (the hotel's
// calendar dates). "unpriced": live bookings without a selling price, as the reports count them.
export type BookingFilters = { bookedFrom?: string; bookedTo?: string; checkinFrom?: string; checkinTo?: string; unpriced?: boolean };
type Options = { tab: BookingTab; q?: string; cursor?: string; take?: number } & BookingFilters;

const DAY_MS = 86_400_000;
const isDay = (v: string | undefined): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

// The filters from a page's or the export's query (the same names on both); anything else is left out.
export function readBookingFilters(get: (key: string) => string | null | undefined): BookingFilters {
  const day = (key: string) => {
    const v = get(key)?.slice(0, 10);
    return isDay(v ?? undefined) ? { [key]: v as string } : {};
  };
  return { ...day("bookedFrom"), ...day("bookedTo"), ...day("checkinFrom"), ...day("checkinTo"), ...(get("unpriced") === "1" ? { unpriced: true } : {}) };
}

function whereFor(agencyId: string, opts: Options, now: Date): Prisma.BookingWhereInput {
  const today = now.toISOString().slice(0, 10);
  const where: Prisma.BookingWhereInput = { agencyId, status: { in: LISTED } };
  const and: Prisma.BookingWhereInput[] = [];
  if (isDay(opts.bookedFrom)) and.push({ createdAt: { gte: new Date(`${opts.bookedFrom}T00:00:00Z`) } });
  if (isDay(opts.bookedTo)) and.push({ createdAt: { lt: new Date(Date.parse(`${opts.bookedTo}T00:00:00Z`) + DAY_MS) } });
  if (isDay(opts.checkinFrom)) and.push({ checkin: { gte: opts.checkinFrom } });
  if (isDay(opts.checkinTo)) and.push({ checkin: { lte: opts.checkinTo } });
  if (opts.unpriced) and.push({ status: { in: ["PENDING_CONFIRMATION", "CONFIRMED", "CANCEL_PENDING"] }, sellMinor: null, sellMarkupType: null });
  if (and.length > 0) where.AND = and;
  if (opts.tab === "upcoming") Object.assign(where, { status: "CONFIRMED", checkin: { gt: today } });
  if (opts.tab === "in_stay") Object.assign(where, { status: "CONFIRMED", checkin: { lte: today }, checkout: { gt: today } });
  if (opts.tab === "completed") Object.assign(where, { status: "CONFIRMED", checkout: { lte: today } });
  if (opts.tab === "pending") where.status = { in: ["PENDING_CONFIRMATION", "CANCEL_PENDING"] };
  if (opts.tab === "cancelled") where.status = { in: ["CANCELLED", "CANCELLED_BY_SUPPLIER"] };
  if (opts.tab === "failed") where.status = "FAILED";
  if (opts.tab === "not_finished") where.status = "DRAFT";
  const raw = opts.q?.trim().slice(0, 100);
  // Prisma passes `contains` to LIKE as is: escape "%", "_" and "\" so they match literally.
  const q = raw?.replace(/[\\%_]/g, (c) => `\\${c}`);
  if (q) {
    where.OR = [
      { reference: { contains: q, mode: "insensitive" } },
      { hotelName: { contains: q, mode: "insensitive" } },
      { leadFamilyName: { contains: q, mode: "insensitive" } },
      { leadGivenName: { contains: q, mode: "insensitive" } },
      { hotelConfirmationId: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

const SELECT = {
  id: true,
  reference: true,
  status: true,
  hotelName: true,
  hotelCity: true,
  leadGivenName: true,
  leadFamilyName: true,
  checkin: true,
  checkout: true,
  totalMinor: true,
  chargedMinor: true,
  sellMarkupType: true,
  sellMarkupValue: true,
  sellMinor: true,
  refundable: true,
  cancelPenalties: true,
  nonrefundableDateRanges: true,
  freeCancelEndsAt: true,
  currency: true,
  createdAt: true,
  // Plan 10: how many rooms (counted in the same query; the rooms' bookingId is indexed).
  _count: { select: { rooms: true } },
} satisfies Prisma.BookingSelect;

type SelectedRow = Prisma.BookingGetPayload<{ select: typeof SELECT }>;
export type BookingRow = Omit<SelectedRow, "_count"> & { roomCount: number };

// A booking is at least one room (one made before its rooms were stored counts as one).
function withRoomCount({ _count, ...row }: SelectedRow): BookingRow {
  return { ...row, roomCount: Math.max(1, _count.rooms) };
}

export async function listBookings(agencyId: string, opts: Options, now: Date = new Date()): Promise<{ rows: BookingRow[]; nextCursor: string | null; total: number }> {
  const take = Math.min(Math.max(1, Math.trunc(opts.take ?? DEFAULT_TAKE)), MAX_TAKE);
  const where = whereFor(agencyId, opts, now);
  let cursor: { id: string } | undefined;
  if (opts.cursor) {
    // The cursor must be one of this agency's bookings; anything else starts from the top.
    const own = typeof opts.cursor === "string" && opts.cursor.length <= 64 ? await db.booking.findFirst({ where: { id: opts.cursor, agencyId }, select: { id: true } }) : null;
    if (own) cursor = { id: own.id };
  }
  const [rows, total] = await Promise.all([
    db.booking.findMany({
      where,
      select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    }),
    db.booking.count({ where }),
  ]);
  return { rows: rows.slice(0, take).map(withRoomCount), nextCursor: rows.length > take ? (rows[take - 1]?.id ?? null) : null, total };
}

// The agency's own bookings for some references (the balance history links each row to its
// booking): reference → booking id. One query; another agency's reference finds nothing.
export async function bookingIdsByReference(agencyId: string, references: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(references.filter((r) => typeof r === "string" && r.length > 0 && r.length <= 40))].slice(0, 200);
  if (wanted.length === 0) return new Map();
  const rows = await db.booking.findMany({ where: { agencyId, reference: { in: wanted } }, select: { id: true, reference: true } });
  return new Map(rows.map((r) => [r.reference, r.id]));
}

export function decimal(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  return `${minor < 0 ? "-" : ""}${whole}${exponent > 0 ? `.${digits.slice(-exponent)}` : ""}`;
}

// A cell that a spreadsheet could run as a formula gets a leading apostrophe; every cell is quoted.
export function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

// The file starts with the UTF-8 byte order mark, so Excel reads names in any script. At most
// 5,000 bookings, newest first; an export that was cut says so in a last row, with how many
// bookings are missing (the file never looks complete when it is not).
export async function bookingsCsv(agencyId: string, opts: Omit<Options, "cursor" | "take">, now: Date = new Date(), limits: { maxRows?: number } = {}): Promise<string> {
  const maxRows = Math.min(Math.max(1, Math.trunc(limits.maxRows ?? CSV_MAX_ROWS)), CSV_MAX_ROWS);
  const where = whereFor(agencyId, opts, now);
  const rows = (await db.booking.findMany({ where, select: SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: maxRows })).map(withRoomCount);
  const missing = rows.length < maxRows ? 0 : Math.max(0, (await db.booking.count({ where })) - rows.length);
  // "Rooms" is the last column (plan 10), so the earlier columns keep their places.
  const header = ["Reference", "Status", "Hotel", "City", "Lead guest", "Check-in", "Check-out", "Total", "Currency", "Booked at (UTC)", "Rooms"].join(",");
  const lines = rows.map((r) =>
    [
      r.reference,
      cell(STATUS_LABEL[r.status]),
      cell(r.hotelName),
      cell(r.hotelCity),
      cell(`${r.leadGivenName} ${r.leadFamilyName}`),
      r.checkin,
      r.checkout,
      decimal(r.totalMinor, r.currency),
      r.currency,
      r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      String(r.roomCount),
    ].join(","),
  );
  const cut =
    missing > 0
      ? [cell(`This export was cut at ${rows.length.toLocaleString("en-US")} rows: ${missing.toLocaleString("en-US")} more ${missing === 1 ? "booking is" : "bookings are"} not in this file. Narrow the list with the tabs or the search box, then export again.`)]
      : [];
  return `${UTF8_BOM}${[header, ...lines, ...cut].join("\r\n")}\r\n`;
}

// The quote a booking was made from, for the booking page's link: its id and the agency's own
// running number ("Q-12"). null: no quote, or not this agency's.
export async function bookingQuote(agencyId: string, quoteId: string | null): Promise<{ id: string; number: number } | null> {
  if (!quoteId) return null;
  const quote = await db.quote.findFirst({ where: { id: quoteId, agencyId }, select: { id: true, number: true, agencyNumber: true } });
  return quote ? { id: quote.id, number: quote.agencyNumber ?? quote.number } : null;
}

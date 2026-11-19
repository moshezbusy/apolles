import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { currencyExponent } from "@/lib/supplier-money";
import { db } from "@/server/db";

// The agency's bookings list (screen 13) and its CSV export. Always scoped by agencyId;
// drafts and expired drafts are not bookings and never listed.

export type BookingTab = "all" | "upcoming" | "in_stay" | "completed" | "pending" | "cancelled";
export const BOOKING_TABS: readonly BookingTab[] = ["all", "upcoming", "in_stay", "completed", "pending", "cancelled"];

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
const MAX_TAKE = 100;
const CSV_MAX_ROWS = 5_000;

type Options = { tab: BookingTab; q?: string; cursor?: string; take?: number };

function whereFor(agencyId: string, opts: Options, now: Date): Prisma.BookingWhereInput {
  const today = now.toISOString().slice(0, 10);
  const where: Prisma.BookingWhereInput = { agencyId, status: { in: LISTED } };
  if (opts.tab === "upcoming") Object.assign(where, { status: "CONFIRMED", checkin: { gt: today } });
  if (opts.tab === "in_stay") Object.assign(where, { status: "CONFIRMED", checkin: { lte: today }, checkout: { gt: today } });
  if (opts.tab === "completed") Object.assign(where, { status: "CONFIRMED", checkout: { lte: today } });
  if (opts.tab === "pending") where.status = { in: ["PENDING_CONFIRMATION", "CANCEL_PENDING"] };
  if (opts.tab === "cancelled") where.status = { in: ["CANCELLED", "CANCELLED_BY_SUPPLIER"] };
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
  refundable: true,
  cancelPenalties: true,
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

export async function listBookings(agencyId: string, opts: Options, now: Date = new Date()): Promise<{ rows: BookingRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(1, Math.trunc(opts.take ?? DEFAULT_TAKE)), MAX_TAKE);
  const where = whereFor(agencyId, opts, now);
  let cursor: { id: string } | undefined;
  if (opts.cursor) {
    // The cursor must be one of this agency's bookings; anything else starts from the top.
    const own = typeof opts.cursor === "string" && opts.cursor.length <= 64 ? await db.booking.findFirst({ where: { id: opts.cursor, agencyId }, select: { id: true } }) : null;
    if (own) cursor = { id: own.id };
  }
  const rows = await db.booking.findMany({
    where,
    select: SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
  });
  return { rows: rows.slice(0, take).map(withRoomCount), nextCursor: rows.length > take ? (rows[take - 1]?.id ?? null) : null };
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

export async function bookingsCsv(agencyId: string, opts: Omit<Options, "cursor" | "take">, now: Date = new Date()): Promise<string> {
  const rows = (await db.booking.findMany({ where: whereFor(agencyId, opts, now), select: SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: CSV_MAX_ROWS })).map(withRoomCount);
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
  return `${[header, ...lines].join("\r\n")}\r\n`;
}

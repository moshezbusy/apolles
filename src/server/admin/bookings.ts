import type { BookingStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

// Admin views (spec section 3 row 14): every agency's bookings, one booking with its event
// trail and the supplier's own reference (ER1: admin only), and the supplier call log. The
// callers check requireAdmin(). Lists page with a cursor (id of the last row).

const TAKE = 50;

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function cursorRow<T extends { id: string }>(find: () => Promise<T | null>): Promise<{ id: string } | undefined> {
  const row = await find();
  return row ? { id: row.id } : undefined;
}

export type AdminBookingFilters = {
  status?: BookingStatus;
  needsAttention?: boolean;
  agencyId?: string;
  from?: string; // booking date (createdAt, UTC), YYYY-MM-DD, inclusive
  to?: string;
  q?: string;
  cursor?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date "YYYY-MM-DD" as the start of that day (UTC), else null.
export function dayStart(day: string | undefined): Date | null {
  if (!day || !DAY.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date;
}

function bookingWhere(opts: AdminBookingFilters): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { status: opts.status ?? { notIn: ["DRAFT", "EXPIRED"] } };
  if (opts.agencyId && opts.agencyId.length <= 64) where.agencyId = opts.agencyId;
  const from = dayStart(opts.from);
  const to = dayStart(opts.to);
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) };
  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    const term = escapeLike(q);
    where.OR = [
      { reference: { contains: term, mode: "insensitive" } },
      { hotelName: { contains: term, mode: "insensitive" } },
      { leadFamilyName: { contains: term, mode: "insensitive" } },
      { supplierItineraryId: { contains: term } },
      { agency: { name: { contains: term, mode: "insensitive" } } },
    ];
  }
  return where;
}

const LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  hotelName: true,
  checkin: true,
  checkout: true,
  totalMinor: true,
  supplierItineraryId: true,
  needsAttention: true,
  createdAt: true,
  agency: { select: { name: true } },
} as const;

// Every agency's bookings, newest first (index createdAt, id), with the filters above.
// "Needs attention" first: on the first page, the flagged bookings that match come in their own
// list (`attention`, at most 50, `attentionMore` when there are more) and the main list holds the
// others. With `needsAttention` only the flagged ones are listed, a page at a time.
export async function listAllBookings(opts: AdminBookingFilters) {
  const base = bookingWhere(opts);
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await cursorRow(() => db.booking.findUnique({ where: { id: opts.cursor! }, select: { id: true } })) : undefined;
  const page = (where: Prisma.BookingWhereInput, withCursor: boolean) =>
    db.booking.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE + 1,
      ...(withCursor && cursor ? { cursor, skip: 1 } : {}),
      select: LIST_SELECT,
    });
  const split = !opts.needsAttention;
  const [rows, attention] = await Promise.all([
    page({ ...base, needsAttention: split ? false : true }, true),
    split && !cursor ? page({ ...base, needsAttention: true }, false) : Promise.resolve([]),
  ]);
  return {
    attention: attention.slice(0, TAKE),
    attentionMore: attention.length > TAKE,
    rows: rows.slice(0, TAKE),
    nextCursor: rows.length > TAKE ? (rows[TAKE - 1]?.id ?? null) : null,
  };
}

// For the agency filter: every agency by name (phase 1 has dozens, not thousands).
export async function agencyOptions(): Promise<{ id: string; name: string }[]> {
  return db.agency.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], take: 500, select: { id: true, name: true } });
}

// Header counters (AdminHeader): two small counts on indexed columns.
export async function adminHeaderCounts(): Promise<{ applications: number; attention: number; changeRequests: number }> {
  const [applications, attention, changeRequests] = await Promise.all([
    db.agencyApplication.count({ where: { status: "PENDING" } }),
    db.booking.count({ where: { needsAttention: true } }),
    db.changeRequest.count({ where: { status: "OPEN" } }),
  ]);
  return { applications, attention, changeRequests };
}

export async function getBookingForAdmin(id: string) {
  if (typeof id !== "string" || id.length > 64) return null;
  return db.booking.findUnique({
    where: { id },
    include: {
      agency: { select: { id: true, name: true } },
      user: { select: { email: true, name: true } },
      changeRequests: { where: { status: "OPEN" }, select: { id: true } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { email: true } } } },
      // Plan 10: the rooms in room order, without the supplier's cancel link (server-only).
      rooms: { orderBy: { index: "asc" }, omit: { cancelLink: true } },
    },
  });
}

// The kinds of supplier call, by method and path (the admin's "call type" filter).
export const SUPPLIER_CALL_TYPES = {
  search: { label: "Search", where: { method: "GET", path: { startsWith: "/properties/availability" } } },
  "price-check": { label: "Price check", where: { method: "GET", path: { startsWith: "/properties/" }, AND: [{ path: { contains: "/rooms/" } }] } },
  book: { label: "Book", where: { method: "POST", path: { startsWith: "/itineraries" } } },
  retrieve: { label: "Retrieve", where: { method: "GET", path: { startsWith: "/itineraries" } } },
  cancel: { label: "Cancel", where: { method: "DELETE" } },
  content: {
    label: "Content",
    where: { OR: [{ path: { startsWith: "/regions" } }, { path: { startsWith: "/files/" } }, { path: { startsWith: "/properties/content" } }, { path: { startsWith: "/properties/inactive" } }] },
  },
} as const satisfies Record<string, { label: string; where: Prisma.SupplierCallLogWhereInput }>;
export type SupplierCallType = keyof typeof SUPPLIER_CALL_TYPES;

export function isSupplierCallType(value: string | undefined): value is SupplierCallType {
  return value !== undefined && Object.hasOwn(SUPPLIER_CALL_TYPES, value);
}

// Newest first (index createdAt). Filters: our booking reference, errors only (no answer, or an
// HTTP status of 400 and up), the call type, and a day range (UTC, inclusive).
export async function listSupplierLog(opts: { reference?: string; errorsOnly?: boolean; type?: SupplierCallType; from?: string; to?: string; cursor?: string }) {
  const and: Prisma.SupplierCallLogWhereInput[] = [];
  const ref = opts.reference?.trim().slice(0, 28);
  if (ref) and.push({ affiliateReferenceId: ref });
  if (opts.errorsOnly) and.push({ OR: [{ error: { not: null } }, { status: null }, { status: { gte: 400 } }] });
  if (opts.type) and.push(SUPPLIER_CALL_TYPES[opts.type].where);
  const from = dayStart(opts.from);
  const to = dayStart(opts.to);
  if (from) and.push({ createdAt: { gte: from } });
  if (to) and.push({ createdAt: { lt: new Date(to.getTime() + 86_400_000) } });
  const where: Prisma.SupplierCallLogWhereInput = and.length ? { AND: and } : {};
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await cursorRow(() => db.supplierCallLog.findUnique({ where: { id: opts.cursor! }, select: { id: true } })) : undefined;
  const rows = await db.supplierCallLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TAKE + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
    select: { id: true, method: true, path: true, status: true, durationMs: true, affiliateReferenceId: true, error: true, unknownFields: true, createdAt: true },
  });
  return { rows: rows.slice(0, TAKE), nextCursor: rows.length > TAKE ? (rows[TAKE - 1]?.id ?? null) : null };
}

// The bodies of one call (already masked when written: no personal or card data).
export async function getSupplierCall(id: string) {
  if (typeof id !== "string" || id.length > 64) return null;
  return db.supplierCallLog.findUnique({ where: { id } });
}

// Supplier log rows older than 90 days are deleted (spec section 6: kept 90 days).
export const SUPPLIER_LOG_DAYS = 90;
export async function cleanupSupplierLog(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - SUPPLIER_LOG_DAYS * 86_400_000);
  return (await db.supplierCallLog.deleteMany({ where: { createdAt: { lt: before } } })).count;
}

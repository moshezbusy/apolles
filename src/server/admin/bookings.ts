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

export async function listAllBookings(opts: { status?: BookingStatus; q?: string; cursor?: string; needsAttention?: boolean }) {
  const where: Prisma.BookingWhereInput = { status: opts.status ?? { notIn: ["DRAFT", "EXPIRED"] } };
  if (opts.needsAttention) where.needsAttention = true;
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
  const cursor = opts.cursor && opts.cursor.length <= 64 ? await cursorRow(() => db.booking.findUnique({ where: { id: opts.cursor! }, select: { id: true } })) : undefined;
  const rows = await db.booking.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: TAKE + 1,
    ...(cursor ? { cursor, skip: 1 } : {}),
    select: {
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
    },
  });
  return { rows: rows.slice(0, TAKE), nextCursor: rows.length > TAKE ? (rows[TAKE - 1]?.id ?? null) : null };
}

export async function getBookingForAdmin(id: string) {
  if (typeof id !== "string" || id.length > 64) return null;
  return db.booking.findUnique({
    where: { id },
    include: {
      agency: { select: { id: true, name: true } },
      user: { select: { email: true, name: true } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { email: true } } } },
    },
  });
}

export async function listSupplierLog(opts: { reference?: string; cursor?: string }) {
  const where: Prisma.SupplierCallLogWhereInput = {};
  const ref = opts.reference?.trim().slice(0, 28);
  if (ref) where.affiliateReferenceId = ref;
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

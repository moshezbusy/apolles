import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Occupancy } from "@/server/supplier/types";

// "Recent searches" (screen 07, plan 8d): the agent's last 5 searches (destination, dates and
// guests; nothing else), for "Search again". Scoped by user and agency.
// Plan 10: a search keeps its rooms; adults and childAges keep the totals over all rooms. A row
// saved before plan 10 has no rooms and reads as one room of its adults and children.
const KEEP = 5;

export type RecentSearchRow = { id: string; destinationId: string; destinationName: string; checkin: string; checkout: string; adults: number; childAges: number[]; rooms: Occupancy[] };

const storedRooms = z.array(z.object({ adults: z.number().int(), childAges: z.array(z.number().int()) })).min(1).max(8);

export async function rememberSearch(
  ctx: { agencyId: string; userId: string },
  search: { destinationId: string; destinationName: string; checkin: string; checkout: string; rooms: Occupancy[] },
): Promise<void> {
  const { rooms, ...rest } = search;
  const totals = { adults: rooms.reduce((n, r) => n + r.adults, 0), childAges: rooms.flatMap((r) => r.childAges) };
  const roomsJson = rooms.map((r) => ({ adults: r.adults, childAges: r.childAges }));
  await db.$transaction(async (tx) => {
    // One save at a time per user, so two at once keep the list at 5 without repeats.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recent:${ctx.userId}`}))`;
    // The same search again moves to the top instead of being listed twice. The same guests in
    // other rooms are another search; an older row (no rooms) is the same as one room.
    const same = { userId: ctx.userId, agencyId: ctx.agencyId, destinationId: search.destinationId, checkin: search.checkin, checkout: search.checkout, ...totals, childAges: { equals: totals.childAges } };
    await tx.recentSearch.deleteMany({
      where: { ...same, OR: [{ rooms: { equals: roomsJson } }, ...(rooms.length === 1 ? [{ rooms: { equals: Prisma.DbNull } }] : [])] },
    });
    await tx.recentSearch.create({ data: { agencyId: ctx.agencyId, userId: ctx.userId, ...rest, ...totals, rooms: roomsJson } });
    const old = await tx.recentSearch.findMany({ where: { userId: ctx.userId, agencyId: ctx.agencyId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: KEEP, select: { id: true } });
    if (old.length) await tx.recentSearch.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  });
}

export async function recentSearches(ctx: { agencyId: string; userId: string }): Promise<RecentSearchRow[]> {
  const rows = await db.recentSearch.findMany({
    where: { userId: ctx.userId, agencyId: ctx.agencyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: KEEP,
    select: { id: true, destinationId: true, destinationName: true, checkin: true, checkout: true, adults: true, childAges: true, rooms: true },
  });
  return rows.map(({ rooms, ...row }) => {
    const parsed = storedRooms.safeParse(rooms);
    return { ...row, rooms: parsed.success ? parsed.data : [{ adults: row.adults, childAges: row.childAges }] };
  });
}

export async function clearRecentSearches(ctx: { agencyId: string; userId: string }): Promise<void> {
  await db.recentSearch.deleteMany({ where: { userId: ctx.userId, agencyId: ctx.agencyId } });
}

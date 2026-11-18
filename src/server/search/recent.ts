import { db } from "@/server/db";

// "Recent searches" (screen 07, plan 8d): the agent's last 5 searches (destination, dates and
// guests; nothing else), for "Search again". Scoped by user and agency.
const KEEP = 5;

export type RecentSearchRow = { id: string; destinationId: string; destinationName: string; checkin: string; checkout: string; adults: number; childAges: number[] };

export async function rememberSearch(
  ctx: { agencyId: string; userId: string },
  search: { destinationId: string; destinationName: string; checkin: string; checkout: string; adults: number; childAges: number[] },
): Promise<void> {
  await db.$transaction(async (tx) => {
    // The same search again moves to the top instead of being listed twice.
    await tx.recentSearch.deleteMany({
      where: { userId: ctx.userId, agencyId: ctx.agencyId, destinationId: search.destinationId, checkin: search.checkin, checkout: search.checkout, adults: search.adults, childAges: { equals: search.childAges } },
    });
    await tx.recentSearch.create({ data: { agencyId: ctx.agencyId, userId: ctx.userId, ...search } });
    const old = await tx.recentSearch.findMany({ where: { userId: ctx.userId, agencyId: ctx.agencyId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: KEEP, select: { id: true } });
    if (old.length) await tx.recentSearch.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  });
}

export async function recentSearches(ctx: { agencyId: string; userId: string }): Promise<RecentSearchRow[]> {
  return db.recentSearch.findMany({
    where: { userId: ctx.userId, agencyId: ctx.agencyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: KEEP,
    select: { id: true, destinationId: true, destinationName: true, checkin: true, checkout: true, adults: true, childAges: true },
  });
}

export async function clearRecentSearches(ctx: { agencyId: string; userId: string }): Promise<void> {
  await db.recentSearch.deleteMany({ where: { userId: ctx.userId, agencyId: ctx.agencyId } });
}

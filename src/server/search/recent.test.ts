import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { clearRecentSearches, recentSearches, rememberSearch } from "./recent";

const A = { agencyId: "A", userId: "u-A" };
const B = { agencyId: "B", userId: "u-B" };
const S = (n: number) => ({ destinationId: `d${n}`, destinationName: `City ${n}`, checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] as number[] }] });

beforeEach(async () => {
  await resetTestDb();
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
});

describe("recent searches (screen 07)", () => {
  it("keeps the last 5 per user, newest first, no repeats; another user sees none; Clear all", async () => {
    for (let n = 1; n <= 7; n++) await rememberSearch(A, S(n));
    await rememberSearch(A, S(4)); // the same search again moves to the top
    expect((await recentSearches(A)).map((r) => r.destinationName)).toEqual(["City 4", "City 7", "City 6", "City 5", "City 3"]);
    expect(await recentSearches(B)).toEqual([]);
    await rememberSearch(B, S(9));
    await clearRecentSearches(A);
    expect(await recentSearches(A)).toEqual([]);
    expect(await recentSearches(B)).toHaveLength(1);
  });

  it("several rooms (plan 10): kept with the search, totals in adults and childAges; another split of the same guests is another search", async () => {
    const rooms = [{ adults: 2, childAges: [9] }, { adults: 1, childAges: [4] }];
    await rememberSearch(A, { ...S(1), rooms });
    await rememberSearch(A, { ...S(1), rooms: [{ adults: 3, childAges: [9, 4] }] });
    await rememberSearch(A, { ...S(1), rooms }); // the same rooms again: moved to the top, not repeated
    const list = await recentSearches(A);
    expect(list.map((r) => r.rooms)).toEqual([rooms, [{ adults: 3, childAges: [9, 4] }]]);
    expect(list[0]).toMatchObject({ adults: 3, childAges: [9, 4] });
    expect(await db.recentSearch.findFirstOrThrow({ where: { id: list[0]!.id } })).toMatchObject({ rooms, adults: 3, childAges: [9, 4] });
  });

  it("a row saved before rooms reads as one room; the same one-room search again replaces it", async () => {
    await db.recentSearch.create({ data: { ...A, destinationId: "d1", destinationName: "City 1", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [5] } });
    expect((await recentSearches(A)).map((r) => r.rooms)).toEqual([[{ adults: 2, childAges: [5] }]]);
    await rememberSearch(A, { ...S(1), rooms: [{ adults: 2, childAges: [5] }] });
    expect(await db.recentSearch.count({ where: { userId: A.userId } })).toBe(1);
  });
});

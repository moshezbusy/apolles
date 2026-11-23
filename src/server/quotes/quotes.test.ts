import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import {
  CLIENT_CHANGE,
  addFromSearch,
  addStay,
  closeQuote,
  createQuote,
  getQuote,
  listQuotes,
  moveHotel,
  openQuotes,
  quoteNumbers,
  removeHotel,
  removeRoom,
  removeStay,
  setClientCancelDate,
  setRoomPrice,
  toggleAgencyPick,
  updateQuoteSettings,
} from "@/server/quotes/quotes";
import type { Offer } from "@/server/supplier/types";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

const NOW = new Date("2027-03-01T10:00:00.000Z");

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;

function offer(propertyId: string, rateId: string, totalMinor: number, refundable = true): Offer {
  return {
    propertyId,
    roomId: `room-${rateId}`,
    roomName: `Ocean View King ${rateId}`,
    rateId,
    refundable,
    bedGroups: [{ id: "bed1", description: "1 King Bed", priceCheckToken: "secret-token" }],
    cancelPenalties: refundable ? [{ start: "2027-04-03T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }] : [],
    nonrefundableDateRanges: [],
    amenities: ["Breakfast buffet"],
    price: { total: { minor: totalMinor, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
    roomPrices: [{ total: { minor: totalMinor, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }],
  };
}

// A search of `agencyId` with two hotels, kept for 30 minutes from NOW.
async function search(agencyId: string, userId: string, guests = { adults: 2, childAges: [] as number[] }, dates = { checkin: "2027-04-10", checkout: "2027-04-12" }) {
  const snapshot = await db.searchSnapshot.create({
    data: {
      agencyId,
      userId,
      query: { destinationId: "cancun", ...dates, ...guests, countryCode: "IL" },
      candidateIds: ["p1", "p2"],
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    },
  });
  for (const [i, id] of ["p1", "p2"].entries()) {
    await db.searchHotel.create({
      data: {
        snapshotId: snapshot.id,
        propertyId: id,
        position: i,
        name: `Hotel ${id}`,
        city: "Cancun",
        minTotalMinor: 100_000,
        currency: "USD",
        refundableAvailable: true,
        offers: [offer(id, "rA", 100_000), offer(id, "rB", 120_000, false)] as never,
      },
    });
  }
  return snapshot.id;
}

const rate = (snapshotId: string, quoteId = "new", propertyId = "p1", rateId = "rA") => ({ quoteId, snapshotId, propertyId, rateId, bedGroupId: "bed1" });

const SETTINGS = {
  title: "Mexico Honeymoon",
  clientId: "",
  language: "EN" as const,
  message: "Hi Daniel,\r\nhere are the options.",
  showCancellation: true,
  markupType: "PERCENT",
  markupValue: "10",
  adults: "2",
  childAges: "",
};

beforeEach(async () => {
  await resetTestDb();
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
  await db.destination.create({
    data: { id: "cancun", name: "Cancun", nameFull: "Cancun, Quintana Roo, Mexico", type: "city", countryCode: "MX", propertyCount: 2, seenRunId: "r" },
  });
  for (const id of ["p1", "p2"]) {
    await db.property.create({ data: { id, name: `Hotel ${id}`, city: "Cancun", countryCode: "MX", starRating: "5.0", expediaCollect: true, catalogSeenRunId: "r" } });
  }
});

async function quoteWithRoom(): Promise<string> {
  const result = await addFromSearch(agentA, agencyA, rate(await search(agencyA, agentA)), NOW);
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

describe("createQuote and settings", () => {
  it("creates a draft for the agency, with a client of the same agency only", async () => {
    const daniel = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972501234567", email: "", nationality: "IL", notes: "" });
    const other = await createClient(agentB, agencyB, { firstName: "Secret", lastName: "Person", phone: "+15551234567", email: "", nationality: "US", notes: "" });
    if (!daniel.ok || !other.ok) throw new Error("setup");
    const created = await createQuote(agentA, agencyA, { clientId: daniel.id });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await getQuote(agencyA, created.id)).toMatchObject({ status: "DRAFT", client: { firstName: "Daniel" } });
    expect((await createQuote(agentA, agencyA, { clientId: other.id })).ok).toBe(false);
  });

  it("saves the settings and the markup; another agency cannot", async () => {
    const created = await createQuote(agentA, agencyA);
    if (!created.ok) throw new Error("setup");
    expect((await updateQuoteSettings(agentB, agencyB, created.id, { ...SETTINGS, title: "Hacked" })).ok).toBe(false);
    expect((await updateQuoteSettings(agentA, agencyA, created.id, SETTINGS)).ok).toBe(true);
    expect(await getQuote(agencyA, created.id)).toMatchObject({
      title: "Mexico Honeymoon",
      message: "Hi Daniel,\nhere are the options.",
      markupType: "PERCENT",
      markupValue: 1000,
    });
    expect(await getQuote(agencyB, created.id)).toBeNull();
  });

  it("refuses a bad markup, unknown fields, and a guest change once there are rooms", async () => {
    const quoteId = await quoteWithRoom();
    expect((await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, markupValue: "101" })).ok).toBe(false);
    expect((await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, agencyId: agencyB } as never)).ok).toBe(false);
    const changed = await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, adults: "3" });
    expect(changed).toMatchObject({ ok: false, error: expect.stringContaining("guests cannot change") });
  });
});

describe("addFromSearch", () => {
  it("creates a quote with the search's guests, destination, hotel and room, copied on the server", async () => {
    const snapshotId = await search(agencyA, agentA, { adults: 2, childAges: [7] });
    const result = await addFromSearch(agentA, agencyA, rate(snapshotId), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = await getQuote(agencyA, result.id);
    expect(quote).toMatchObject({ adults: 2, childAges: [7] });
    expect(quote?.stays).toMatchObject([{ destinationName: "Cancun, Quintana Roo, Mexico", checkin: "2027-04-10", checkout: "2027-04-12" }]);
    const room = quote?.stays[0]?.hotels[0]?.rooms[0];
    expect(quote?.stays[0]?.hotels[0]).toMatchObject({ name: "Hotel p1", city: "Cancun" });
    expect(room).toMatchObject({ roomName: "Ocean View King rA", bedDescription: "1 King Bed", amenities: ["Breakfast buffet"], netMinor: 100_000, refundable: true, freeCancelUntil: "2027-04-02", clientCancelUntil: "2027-04-01", sellMinor: null });
    // The price-check token never leaves the search.
    expect(JSON.stringify(await db.quoteRoom.findMany())).not.toContain("secret-token");
  });

  it("adds to an existing quote: same destination and dates share one stay; the same rate is added once", async () => {
    const quoteId = await quoteWithRoom();
    const snapshotId = await search(agencyA, agentA);
    expect((await addFromSearch(agentA, agencyA, rate(snapshotId, quoteId, "p1", "rA"), NOW)).ok).toBe(true);
    expect((await addFromSearch(agentA, agencyA, rate(snapshotId, quoteId, "p1", "rB"), NOW)).ok).toBe(true);
    expect((await addFromSearch(agentA, agencyA, rate(snapshotId, quoteId, "p2", "rA"), NOW)).ok).toBe(true);
    const quote = await getQuote(agencyA, quoteId);
    expect(quote?.stays).toHaveLength(1);
    expect(quote?.stays[0]?.hotels.map((h) => [h.name, h.rooms.length])).toEqual([["Hotel p1", 2], ["Hotel p2", 1]]);
    // Non-refundable rate: no dates.
    expect(quote?.stays[0]?.hotels[0]?.rooms[1]).toMatchObject({ refundable: false, freeCancelUntil: null, clientCancelUntil: null });

    const other = await search(agencyA, agentA, undefined, { checkin: "2027-04-12", checkout: "2027-04-15" });
    expect((await addFromSearch(agentA, agencyA, rate(other, quoteId), NOW)).ok).toBe(true);
    expect((await getQuote(agencyA, quoteId))?.stays).toHaveLength(2);
  });

  it("refuses a search for other guests once the quote has rooms", async () => {
    const quoteId = await quoteWithRoom();
    const family = await search(agencyA, agentA, { adults: 2, childAges: [5] });
    const result = await addFromSearch(agentA, agencyA, rate(family, quoteId), NOW);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("other guests") });
  });

  it("refuses an expired search, another agency's search and another agency's quote", async () => {
    const snapshotId = await search(agencyA, agentA);
    expect((await addFromSearch(agentA, agencyA, rate(snapshotId), new Date(NOW.getTime() + 31 * 60_000))).ok).toBe(false);
    expect((await addFromSearch(agentB, agencyB, rate(snapshotId), NOW)).ok).toBe(false);
    const quoteId = await quoteWithRoom();
    const theirs = await search(agencyB, agentB);
    expect((await addFromSearch(agentB, agencyB, rate(theirs, quoteId), NOW)).ok).toBe(false);
    expect(await db.quote.count({ where: { agencyId: agencyB } })).toBe(0);
  });

  it("refuses a search of several rooms (plan 10): quotes are for one room for now", async () => {
    const snapshotId = await search(agencyA, agentA);
    const half = offer("p1", "rA", 50_000).price;
    await db.searchSnapshot.update({
      where: { id: snapshotId },
      data: { query: { destinationId: "cancun", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }], countryCode: "IL" } },
    });
    await db.searchHotel.updateMany({ where: { snapshotId, propertyId: "p1" }, data: { offers: [{ ...offer("p1", "rA", 100_000), roomPrices: [half, half] }] as never } });
    expect(await addFromSearch(agentA, agencyA, rate(snapshotId), NOW)).toEqual({ ok: false, error: "Quotes are for one room for now." });
    expect(await db.quote.count()).toBe(0);
  });
});

describe("editing hotels, rooms and destinations", () => {
  it("room price: typed price, back to markup, and the totals", async () => {
    const quoteId = await quoteWithRoom();
    await updateQuoteSettings(agentA, agencyA, quoteId, SETTINGS);
    const roomId = (await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.id ?? "";
    expect((await setRoomPrice(agentA, agencyA, roomId, "1,284.50")).ok).toBe(true);
    expect((await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.sellMinor).toBe(128_450);
    expect((await setRoomPrice(agentA, agencyA, roomId, "abc")).ok).toBe(false);
    expect((await setRoomPrice(agentA, agencyA, roomId, "")).ok).toBe(true);
    const quote = await getQuote(agencyA, quoteId);
    if (!quote) throw new Error("missing");
    expect(quoteNumbers(quote)).toEqual({ options: 1, lowestSell: 110_000, profitMin: 10_000, profitMax: 10_000 });
  });

  it("a selling price of 0 is refused; a price below the net is saved only with the agent's explicit yes", async () => {
    const quoteId = await quoteWithRoom();
    const roomId = (await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.id ?? "";
    const stored = async () => (await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.sellMinor;
    for (const zero of ["0", "0.00", "000"]) expect(await setRoomPrice(agentA, agencyA, roomId, zero)).toMatchObject({ ok: false, error: expect.stringContaining("cannot be 0") });
    // The net is 1,000.00: "100" is a slipped digit until the agent says it is meant.
    expect(await setRoomPrice(agentA, agencyA, roomId, "100")).toMatchObject({ ok: false, confirm: "belowNet", error: expect.stringContaining("below your net price (USD 1,000.00)") });
    expect(await stored()).toBeNull();
    expect(await setRoomPrice(agentA, agencyA, roomId, "999.99", { confirmBelowNet: true })).toEqual({ ok: true, id: quoteId });
    expect(await stored()).toBe(99_999);
    // The net itself, or more, needs no confirmation.
    expect((await setRoomPrice(agentA, agencyA, roomId, "1000")).ok).toBe(true);
  });

  it("client cancellation date: after today and at least one day before the supplier's deadline", async () => {
    const quoteId = await quoteWithRoom();
    const roomId = (await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.id ?? "";
    // The supplier's last free day is Apr 2: the client is shown Apr 1 at the latest.
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-04-01", NOW)).ok).toBe(true);
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-03-15", NOW)).ok).toBe(true);
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-04-02", NOW)).ok).toBe(false);
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-04-03", NOW)).ok).toBe(false);
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-02-28", NOW)).ok).toBe(false);
    // Today is over already (NOW is Mar 1).
    expect((await setClientCancelDate(agentA, agencyA, roomId, "2027-03-01", NOW)).ok).toBe(false);
    expect((await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms[0]?.clientCancelUntil).toBe("2027-03-15");
  });

  it("a refundable rate keeps the supplier's own flag whatever its dates; the client is shown no free cancellation that is not ahead", async () => {
    const snapshotId = await search(agencyA, agentA);
    // rA: refundable, last free day Apr 2. Added on Apr 2: the day before it (Apr 1) has passed.
    const late = new Date("2027-04-02T10:00:00.000Z");
    await db.searchSnapshot.update({ where: { id: snapshotId }, data: { expiresAt: new Date(late.getTime() + 60_000) } });
    // rC: refundable with no charge listed at all.
    const noDates = { ...offer("p1", "rC", 90_000), cancelPenalties: [] };
    await db.searchHotel.updateMany({ where: { snapshotId, propertyId: "p1" }, data: { offers: [offer("p1", "rA", 100_000), noDates] as never } });
    const made = await addFromSearch(agentA, agencyA, rate(snapshotId), late);
    if (!made.ok) throw new Error(made.error);
    await addFromSearch(agentA, agencyA, rate(snapshotId, made.id, "p1", "rC"), late);
    const rooms = (await getQuote(agencyA, made.id))?.stays[0]?.hotels[0]?.rooms ?? [];
    // Before: both were stored as non-refundable, and could be matched to a truly non-refundable rate.
    expect(rooms[0]).toMatchObject({ refundable: true, freeCancelUntil: "2027-04-02", clientCancelUntil: null });
    expect(rooms[1]).toMatchObject({ refundable: true, freeCancelUntil: null, clientCancelUntil: null });
  });

  it("move, pick and remove hotels; remove rooms and destinations; nothing works across agencies", async () => {
    const quoteId = await quoteWithRoom();
    await addFromSearch(agentA, agencyA, rate(await search(agencyA, agentA), quoteId, "p2"), NOW);
    let quote = await getQuote(agencyA, quoteId);
    const [h1, h2] = quote?.stays[0]?.hotels ?? [];
    if (!h1 || !h2) throw new Error("setup");

    expect((await moveHotel(agentB, agencyB, h2.id, "up")).ok).toBe(false);
    expect((await toggleAgencyPick(agentB, agencyB, h2.id)).ok).toBe(false);
    expect((await removeHotel(agentB, agencyB, h2.id)).ok).toBe(false);
    expect((await removeRoom(agentB, agencyB, h1.rooms[0]?.id ?? "")).ok).toBe(false);
    expect((await removeStay(agentB, agencyB, quote?.stays[0]?.id ?? "")).ok).toBe(false);

    await moveHotel(agentA, agencyA, h2.id, "up");
    await toggleAgencyPick(agentA, agencyA, h2.id);
    quote = await getQuote(agencyA, quoteId);
    expect(quote?.stays[0]?.hotels.map((h) => [h.name, h.agencyPick])).toEqual([["Hotel p2", true], ["Hotel p1", false]]);

    await removeRoom(agentA, agencyA, h1.rooms[0]?.id ?? "");
    await removeHotel(agentA, agencyA, h2.id);
    quote = await getQuote(agencyA, quoteId);
    expect(quote?.stays[0]?.hotels.map((h) => [h.name, h.rooms.length])).toEqual([["Hotel p1", 0]]);
    await removeStay(agentA, agencyA, quote?.stays[0]?.id ?? "");
    expect((await getQuote(agencyA, quoteId))?.stays).toEqual([]);
  });

  it("adds a destination with valid dates only", async () => {
    const created = await createQuote(agentA, agencyA);
    if (!created.ok) throw new Error("setup");
    expect((await addStay(agentA, agencyA, created.id, { destinationId: "cancun", checkin: "2027-04-10", checkout: "2027-04-12" }, NOW)).ok).toBe(true);
    expect((await addStay(agentA, agencyA, created.id, { destinationId: "cancun", checkin: "2027-02-10", checkout: "2027-02-12" }, NOW)).ok).toBe(false);
    expect((await addStay(agentA, agencyA, created.id, { destinationId: "cancun", checkin: "2027-04-10", checkout: "2027-05-30" }, NOW)).ok).toBe(false);
    expect((await addStay(agentA, agencyA, created.id, { destinationId: "nowhere", checkin: "2027-04-10", checkout: "2027-04-12" }, NOW)).ok).toBe(false);
    expect((await addStay(agentB, agencyB, created.id, { destinationId: "cancun", checkin: "2027-04-10", checkout: "2027-04-12" }, NOW)).ok).toBe(false);
  });
});

describe("listQuotes", () => {
  it("lists only the agency's quotes, with counts, tabs and search by title, number, client and destination", async () => {
    const quoteId = await quoteWithRoom();
    const daniel = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972501234567", email: "", nationality: "IL", notes: "" });
    if (!daniel.ok) throw new Error("setup");
    await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: daniel.id });
    await createQuote(agentA, agencyA);
    await createQuote(agentB, agencyB);

    const all = await listQuotes(agencyA, {});
    expect(all.quotes).toHaveLength(2);
    const mine = all.quotes.find((q) => q.id === quoteId);
    expect(mine).toMatchObject({ title: "Mexico Honeymoon", destinations: ["Cancun, Quintana Roo, Mexico"], stays: 1, hotels: 1, rooms: 1, firstCheckin: "2027-04-10", lastCheckout: "2027-04-12", client: { firstName: "Daniel" } });

    // The agency's own running number: its first quote is Q-1, whatever other agencies made.
    const number = mine?.number ?? 0;
    expect(number).toBe(1);
    expect(all.quotes.map((x) => x.number).sort()).toEqual([1, 2]);
    expect((await listQuotes(agencyB, {})).quotes.map((x) => x.number)).toEqual([1]);
    for (const q of ["honeymoon", `Q-${number}`, String(number), "levy", "quintana"]) {
      expect((await listQuotes(agencyA, { q })).quotes.map((x) => x.id)).toEqual([quoteId]);
    }
    // A row from before the per-agency number shows (and is found by) the internal one.
    const legacy = await db.quote.update({ where: { id: quoteId }, data: { agencyNumber: null } });
    expect((await getQuote(agencyA, quoteId))?.number).toBe(legacy.number);
    expect((await listQuotes(agencyA, { q: `Q-${legacy.number}` })).quotes.map((x) => x.id)).toContain(quoteId);
    await db.quote.update({ where: { id: quoteId }, data: { agencyNumber: 1 } });
    expect((await listQuotes(agencyA, { tab: "draft" })).quotes).toHaveLength(2);
    expect((await listQuotes(agencyA, { tab: "sent" })).quotes).toHaveLength(0);
    const theirs = await db.quote.findFirstOrThrow({ where: { agencyId: agencyB } });
    expect((await listQuotes(agencyA, { cursor: theirs.id })).quotes).toHaveLength(2);
  });
});

describe("booked quotes and the quote list for Add to quote", () => {
  it("a booked quote can no longer change", async () => {
    const quoteId = await quoteWithRoom();
    const quote = await getQuote(agencyA, quoteId);
    const hotel = quote?.stays[0]?.hotels[0];
    const room = hotel?.rooms[0];
    if (!quote || !hotel || !room) throw new Error("setup");
    await db.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    for (const result of [
      await updateQuoteSettings(agentA, agencyA, quoteId, SETTINGS),
      await setRoomPrice(agentA, agencyA, room.id, "1500"),
      await removeRoom(agentA, agencyA, room.id),
      await toggleAgencyPick(agentA, agencyA, hotel.id),
      await removeHotel(agentA, agencyA, hotel.id),
      await removeStay(agentA, agencyA, quote.stays[0]?.id ?? ""),
      await addStay(agentA, agencyA, quoteId, { destinationId: "cancun", checkin: "2027-04-10", checkout: "2027-04-12" }, NOW),
      await addFromSearch(agentA, agencyA, rate(await search(agencyA, agentA), quoteId), NOW),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect((await getQuote(agencyA, quoteId))?.stays[0]?.hotels[0]?.rooms).toHaveLength(1);
  });

  it("two quotes made at the same moment get two numbers", async () => {
    // Quotes started for a client always get a new row (an empty "+ New quote" draft is reused).
    const clients = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createClient(agentA, agencyA, { firstName: `C${i}`, lastName: "Test", phone: `+97250000000${i}`, email: "", nationality: "IL", notes: "" })),
    );
    const made = await Promise.all(clients.map((c) => createQuote(agentA, agencyA, { clientId: c.ok ? c.id : "" })));
    const numbers = await Promise.all(made.map(async (m) => (m.ok ? (await getQuote(agencyA, m.id))?.number : 0)));
    expect([...numbers].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("several clicks on + New quote at the same moment open one empty draft", async () => {
    const made = await Promise.all(Array.from({ length: 4 }, () => createQuote(agentA, agencyA)));
    expect(new Set(made.map((m) => (m.ok ? m.id : ""))).size).toBe(1);
    expect(await db.quote.count({ where: { agencyId: agencyA } })).toBe(1);
  });

  it("changing the client asks first, and a closed quote is not offered for 'Add to quote'", async () => {
    const quoteId = await quoteWithRoom();
    const first = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972501234567", email: "", nationality: "IL", notes: "" });
    const second = await createClient(agentA, agencyA, { firstName: "Noa", lastName: "Bar", phone: "+972507654321", email: "", nationality: "IL", notes: "" });
    if (!first.ok || !second.ok) throw new Error("setup");
    // The first client needs no confirmation (nothing can be lost yet).
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: first.id })).toEqual({ ok: true, id: quoteId });
    // Another client, or no client, does.
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: second.id })).toEqual({ ok: false, error: CLIENT_CHANGE, confirm: "clientChange" });
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: "" })).toMatchObject({ ok: false, confirm: "clientChange" });
    expect((await getQuote(agencyA, quoteId))?.client?.id).toBe(first.id);
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: second.id, confirmClientChange: true })).toEqual({ ok: true, id: quoteId, clientChanged: true });
    expect((await getQuote(agencyA, quoteId))?.client?.id).toBe(second.id);

    expect((await openQuotes(agencyA)).map((q) => q.id)).toContain(quoteId);
    await closeQuote(agentA, agencyA, quoteId);
    expect((await openQuotes(agencyA, quoteId)).map((q) => q.id)).not.toContain(quoteId);
    expect(await addFromSearch(agentA, agencyA, rate(await search(agencyA, agentA), quoteId, "p2"), NOW)).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, SETTINGS)).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
  });

  it("two quick Move up clicks are applied one after the other (no two hotels share a position)", async () => {
    const quoteId = await quoteWithRoom();
    const snap = await search(agencyA, agentA);
    await addFromSearch(agentA, agencyA, rate(snap, quoteId, "p2"), NOW);
    const hotels = (await getQuote(agencyA, quoteId))?.stays[0]?.hotels ?? [];
    const last = hotels.at(-1);
    if (!last) throw new Error("setup");
    await Promise.all([moveHotel(agentA, agencyA, last.id, "up"), moveHotel(agentA, agencyA, last.id, "up")]);
    const positions = (await db.quoteHotel.findMany({ where: { stay: { quoteId } }, select: { position: true } })).map((h) => h.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("openQuotes lists the latest 30 and always the quote asked for, if it is the agency's own and open", async () => {
    const old = await createQuote(agentA, agencyA);
    if (!old.ok) throw new Error("setup");
    for (let i = 0; i < 31; i++) await createQuote(agentA, agencyA);
    const theirs = await createQuote(agentB, agencyB);
    if (!theirs.ok) throw new Error("setup");
    expect((await openQuotes(agencyA)).map((q) => q.id)).not.toContain(old.id);
    expect((await openQuotes(agencyA, old.id)).map((q) => q.id)).toContain(old.id);
    expect((await openQuotes(agencyA, theirs.id)).map((q) => q.id)).not.toContain(theirs.id);
  });
});

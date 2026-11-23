import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { listResults, startSearch } from "@/server/search/search";
import { SupplierUnavailable } from "@/server/supplier/expedia/client";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import { MultiSupplierAdapter } from "@/server/supplier/multi";
import type { BookingSupplier, Offer, PropertyOffers, SupplierAdapter, SupplierId } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";
import { book, cancel, cancelQuote, createDraft, prepareReview, reconcile, roomsOf } from "./service";
import { checkConfirmedAtSupplier } from "./upkeep";

// A second supplier (owner decision 2026-11-23): offers carry their supplier, the cheapest of the
// same room wins, the supplier stays hidden, and every step of a booking goes to its own supplier.
// Both suppliers are the fake here; the second one marks its offers "hotelbeds" and sells them
// 10.00 cheaper.

const NOW = new Date("2027-03-01T10:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const ctx = () => ({ agencyId: "A", userId: "u-A", supplierContext: {} });
type Supplier = SupplierAdapter & BookingSupplier;

function counted(name: string, log: string[]): Supplier {
  const real = new FakeSupplierAdapter();
  return {
    searchAvailability: async (q) => {
      log.push(`${name}.search`);
      return real.searchAvailability(q);
    },
    priceCheck: async (r) => {
      log.push(`${name}.priceCheck`);
      return real.priceCheck(r);
    },
    book: async (i) => {
      log.push(`${name}.book`);
      return real.book(i);
    },
    findByAffiliateReference: async (r) => {
      log.push(`${name}.find`);
      return real.findByAffiliateReference(r);
    },
    retrieve: async (l) => {
      log.push(`${name}.retrieve`);
      return real.retrieve(l);
    },
    cancelRoom: async (l) => {
      log.push(`${name}.cancel`);
      return real.cancelRoom(l);
    },
  };
}

// The second supplier's search: the same rooms, marked hotelbeds, 10.00 cheaper.
function cheaperSecond(base: Supplier): SupplierAdapter {
  return {
    searchAvailability: async (q, c): Promise<PropertyOffers[]> =>
      (await base.searchAvailability(q, c)).map((p) => ({
        propertyId: p.propertyId,
        offers: p.offers.map((o) => {
          const price = { ...o.price, total: { ...o.price.total, minor: o.price.total.minor - 1_000 } };
          return { ...o, supplier: "hotelbeds" as const, rateId: `hb-${o.rateId}`, price, roomPrices: [price] };
        }),
      })),
    priceCheck: (r, c) => base.priceCheck(r, c),
  };
}

async function setup() {
  await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u-A", email: "a@test.local", name: "A", role: "AGENT", agencyId: "A" } });
  await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 500_000, reason: "test", idempotencyKey: "seed-topup" });
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
}

const guests = [
  { givenName: "Dana", familyName: "Levi" },
  { givenName: "Avi", familyName: "Levi" },
];

describe("a second supplier", () => {
  let log: string[];
  let main: Supplier;
  let second: Supplier;
  const deps = (now: Date) => ({ supplierFor: (id: SupplierId) => (id === "hotelbeds" ? second : main), now });

  beforeEach(async () => {
    await resetTestDb();
    await setup();
    log = [];
    main = counted("main", log);
    second = counted("hotelbeds", log);
  });
  afterEach(() => vi.restoreAllMocks());

  async function search() {
    const adapter = new MultiSupplierAdapter(main, cheaperSecond(second));
    const { snapshotId } = await startSearch(ctx(), { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] }, { adapter, now: NOW, content: async () => new Map() });
    const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
    return { snapshotId, offers: hotel.offers as unknown as Offer[] };
  }

  it("search: the cheaper supplier wins each room, the stored rates say which supplier, and the results never show it", async () => {
    const { snapshotId, offers } = await search();
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.supplier === "hotelbeds")).toBe(true); // every room is 10.00 cheaper there
    expect(new Set((await db.searchRate.findMany({ where: { snapshotId } })).map((r) => r.supplier))).toEqual(new Set(["hotelbeds"]));
    const results = await listResults("A", snapshotId, { sort: "recommended" }, NOW);
    const card = results!.hotels[0]!;
    expect(card.best).not.toBeNull();
    expect(Object.keys(card.best!.offer)).not.toContain("supplier");
    expect(JSON.stringify(results)).not.toMatch(/hotelbeds/i);
  });

  it("draft, review, book and cancel of a Hotelbeds rate all go to Hotelbeds; the main supplier is never asked", async () => {
    const { snapshotId, offers } = await search();
    const offer = offers.find((o) => o.refundable)!;
    const { bookingId } = await createDraft(
      ctx(),
      { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, rooms: [{ guests }], leadEmail: "dana@example.com", leadPhone: { countryCode: "972", number: "501234567" } },
      { now: NOW },
    );
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).supplier).toBe("hotelbeds");
    log.length = 0;
    const review = await prepareReview(ctx(), bookingId, deps(later(1)));
    if (review.kind !== "ready") throw new Error("not ready");
    const sent: unknown[] = [];
    const book0 = second.book;
    second.book = async (input, c) => {
      sent.push(input.rooms);
      return book0(input, c);
    };
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: review.booking.totalMinor }, deps(later(2)))).toEqual({ kind: "confirmed", bookingId });
    // The layer gets every guest of the room with its occupancy.
    expect(sent).toEqual([[{ givenName: "Dana", familyName: "Levi", guests, adults: 2, childAges: [] }]]);
    const confirmed = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const quote = cancelQuote(confirmed, await roomsOf(confirmed), later(3));
    if (!quote.allowed) throw new Error("not cancellable");
    expect(await cancel(ctx(), bookingId, { expectedChargeMinor: quote.chargeMinor }, deps(later(3)))).toEqual({ kind: "cancelled" });
    expect(log.filter((call) => call.startsWith("main."))).toEqual([]);
    expect(log).toEqual(expect.arrayContaining(["hotelbeds.priceCheck", "hotelbeds.book", "hotelbeds.cancel"]));
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - quote.chargeMinor, heldCents: 0 });
  });

  it("the background check and the daily check read each booking at its own supplier; one supplier down does not stop the other's checks", async () => {
    const base = { userId: "u-A", agencyId: "A", propertyId: "11", hotelName: "Hotel 11", hotelCity: "Paris", roomId: "r", roomName: "Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: "2027-03-05", checkout: "2027-03-07", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "d@e.co", leadPhone: "+972 501234567", guests: [], refundable: true, totalMinor: 10_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "t" };
    const room = { index: 0, adults: 2, childAges: [], guests: [], givenName: "Dana", familyName: "Levi", totalMinor: 10_000, price: {} };
    // Five Hotelbeds bookings first (ids sort first), then one of the main supplier, then one from before (no supplier).
    for (let i = 0; i < 5; i++) await db.booking.create({ data: { ...base, id: `a-hb-${i}`, reference: `APL-HBHBHB0${i + 2}`, status: "CONFIRMED", supplier: "hotelbeds", rooms: { create: room } } });
    await db.booking.create({ data: { ...base, id: "b-main", reference: "APL-MAINMAIN", status: "CONFIRMED", rooms: { create: room } } });
    await db.booking.create({ data: { ...base, id: "c-old", reference: "APL-OLDOLDOL", status: "CONFIRMED", supplier: null, rooms: { create: room } } });
    second.findByAffiliateReference = async () => {
      log.push("hotelbeds.find");
      throw new SupplierUnavailable("down");
    };
    await expect(checkConfirmedAtSupplier("window", deps(NOW))).rejects.toThrow("The supplier is not answering");
    expect(log.filter((c) => c === "hotelbeds.find")).toHaveLength(5);
    expect(log.filter((c) => c === "main.find")).toHaveLength(2); // the main supplier's bookings were still read
    expect((await db.booking.findUniqueOrThrow({ where: { id: "b-main" } })).supplierCheckedAt).not.toBeNull();

    // A pending Hotelbeds booking is reconciled at Hotelbeds.
    log.length = 0;
    await db.booking.update({ where: { id: "a-hb-0" }, data: { status: "PENDING_CONFIRMATION", holdId: "h" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await reconcile("a-hb-0", deps(NOW))).toBe("retry");
    expect(log).toEqual(["hotelbeds.find"]);
  });

  it("booked with a review note from the supplier: confirmed and charged, and flagged for an admin", async () => {
    const { snapshotId, offers } = await search();
    const offer = offers[0]!;
    const { bookingId } = await createDraft(
      ctx(),
      { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, rooms: [{ guests }], leadEmail: "dana@example.com", leadPhone: { countryCode: "972", number: "501234567" } },
      { now: NOW },
    );
    const review = await prepareReview(ctx(), bookingId, deps(later(1)));
    if (review.kind !== "ready") throw new Error("not ready");
    const find0 = second.findByAffiliateReference;
    const retrieve0 = second.retrieve;
    second.findByAffiliateReference = async (r, c) => ({ ...(await find0(r, c))!, reviewNeeded: true });
    second.retrieve = async (l, c) => ({ ...(await retrieve0(l, c)), reviewNeeded: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: review.booking.totalMinor }, deps(later(2)))).toEqual({ kind: "confirmed", bookingId });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", needsAttention: true });
    expect(await db.bookingEvent.count({ where: { bookingId, reason: "The supplier confirmed the booking with a note that needs a review: check it at the supplier" } })).toBe(1);
  });
});

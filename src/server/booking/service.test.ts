import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { startSearch } from "@/server/search/search";
import { SupplierOutcomeUnknown, SupplierRequestRejected, SupplierUnavailable } from "@/server/supplier/expedia/client";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import type { BookingSupplier, Offer, PriceBreakdown, RetrievedItinerary, SupplierAdapter } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { book, cancel, cancelQuote, createDraft, fillRoomsFromSupplier, prepareReview, reconcile } from "./service";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const ctx = (agencyId = "A", userId = "u-A") => ({ agencyId, userId, supplierContext: {} });

type Supplier = SupplierAdapter & BookingSupplier;

// The fake supplier, with booking calls that a test can replace one by one.
function supplier(overrides: Partial<Supplier> = {}): Supplier & { calls: Record<string, number> } {
  const real = new FakeSupplierAdapter();
  const calls: Record<string, number> = { book: 0, priceCheck: 0, cancelRoom: 0, find: 0 };
  return {
    calls,
    searchAvailability: (q) => real.searchAvailability(q),
    priceCheck: async (r, c) => {
      calls.priceCheck!++;
      return overrides.priceCheck ? overrides.priceCheck(r, c) : real.priceCheck(r);
    },
    book: async (i, c) => {
      calls.book!++;
      return overrides.book ? overrides.book(i, c) : real.book(i);
    },
    findByAffiliateReference: async (r, c) => {
      calls.find!++;
      return overrides.findByAffiliateReference ? overrides.findByAffiliateReference(r, c) : real.findByAffiliateReference(r);
    },
    retrieve: async (l, c) => (overrides.retrieve ? overrides.retrieve(l, c) : real.retrieve(l)),
    cancelRoom: async (l, c) => {
      calls.cancelRoom!++;
      return overrides.cancelRoom ? overrides.cancelRoom(l, c) : real.cancelRoom(l);
    },
  };
}

async function setup(balanceCents = 500_000) {
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: id, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
  if (balanceCents > 0) await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: balanceCents, reason: "test", idempotencyKey: "seed-topup" });
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
  const s = supplier();
  const input = { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [7] }] };
  const { snapshotId } = await startSearch(ctx(), input, { adapter: s, now: NOW });
  const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
  const offers = hotel.offers as unknown as Offer[];
  return { snapshotId, offers };
}

const guests = [
  { givenName: "Dana", familyName: "Levi" },
  { givenName: "Avi", familyName: "Levi" },
  { givenName: "Noa", familyName: "Levi" },
];

async function draft(snapshotId: string, offer: Offer, agency = "A") {
  return createDraft(
    ctx(agency, `u-${agency}`),
    { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, rooms: [{ guests }], leadEmail: "Dana@Example.com", leadPhone: { countryCode: "972", number: "501234567" } },
    { now: NOW },
  );
}

async function reviewed(offerIndex = 1, balance = 500_000) {
  const { snapshotId, offers } = await setup(balance);
  const offer = offers[offerIndex]!;
  const { bookingId } = await draft(snapshotId, offer);
  const s = supplier();
  const review = await prepareReview(ctx(), bookingId, { supplier: s, now: later(1) });
  if (review.kind !== "ready") throw new Error("not ready");
  return { bookingId, offer, total: review.booking.totalMinor, snapshotId };
}

describe("booking: draft and review", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("guest titles and special requests are kept; requests go to the hotel; numbers that may be IDs or cards are refused", async () => {
    const { snapshotId, offers } = await setup();
    const offer = offers[0]!;
    const base = { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, leadEmail: "d@example.com", leadPhone: { countryCode: "972", number: "501234567" } };
    const titled = [{ ...guests[0]!, title: "MRS" as const }, guests[1]!, guests[2]!];
    const { bookingId } = await createDraft(ctx(), { ...base, rooms: [{ guests: titled }], specialRequests: { options: ["LATE_CHECKOUT", "HIGH_FLOOR"], text: "Celebrating an anniversary" } }, { now: NOW });
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b.specialRequest).toBe("Late check-out. High floor. Celebrating an anniversary");
    expect((b.guests as { title?: string }[])[0]).toMatchObject({ title: "MRS", givenName: "Dana" });
    for (const bad of ["Passport 12345678", "4111.1111.1111.1111", "4111/1111/1111/1111", "+972.50.123.4567", "050_123_4567", "１２３４５６７８", "٠٥٠١٢٣٤٥٦٧", "mail me a@b.com"]) {
      await expect(createDraft(ctx(), { ...base, rooms: [{ guests }], specialRequests: { options: [], text: bad } }, { now: NOW }), bad).rejects.toThrow(/no ID, card or phone numbers/i);
    }
    // Characters Rapid re-encodes are left out, not refused; the whole text has one limit.
    const ok = await createDraft(ctx(), { ...base, rooms: [{ guests }], specialRequests: { options: [], text: "Twin beds (if possible) & quiet" } }, { now: NOW });
    expect((await db.booking.findUniqueOrThrow({ where: { id: ok.bookingId } })).specialRequest).toBe("Twin beds if possible quiet");
    await expect(
      createDraft(ctx(), { ...base, rooms: [{ guests }], specialRequests: { options: ["EARLY_CHECKIN", "LATE_CHECKOUT", "HIGH_FLOOR", "HONEYMOON"], text: "x".repeat(290) } }, { now: NOW }),
    ).rejects.toThrow(/up to 300 characters/);
    await expect(createDraft(ctx(), { ...base, rooms: [{ guests }], specialRequests: { options: ["FREE_UPGRADE"], text: "" } }, { now: NOW })).rejects.toThrow(/Check the guest names/);
    // Sent with the booking.
    let sentRequest: string | undefined;
    const s = supplier({ book: async (i) => { sentRequest = i.specialRequest; return new FakeSupplierAdapter().book(i); } });
    const review = await prepareReview(ctx(), bookingId, { supplier: s, now: later(1) });
    if (review.kind !== "ready") throw new Error("not ready");
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: review.booking.totalMinor }, { supplier: s, now: later(2) });
    expect(sentRequest).toBe("Late check-out. High floor. Celebrating an anniversary");
  });

  it("a draft takes the rate and price from the agency's own search, never from the browser", async () => {
    const { snapshotId, offers } = await setup();
    const offer = offers[0]!;
    const { bookingId } = await draft(snapshotId, offer);
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({
      status: "DRAFT",
      agencyId: "A",
      totalMinor: offer.price.total.minor,
      roomName: offer.roomName,
      leadEmail: "dana@example.com",
      leadPhone: "+972 501234567",
      adults: 2,
      childAges: [7],
      priceCheckToken: offer.bedGroups[0]!.priceCheckToken,
    });
    expect(b.reference).toMatch(/^APL-[A-HJ-NP-Z2-9]{8}$/);
    // Plan 10: a one-room booking has one room, with all its guests and the whole price.
    const rooms = await db.bookingRoom.findMany({ where: { bookingId } });
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ index: 0, adults: 2, childAges: [7], guests, givenName: "Dana", familyName: "Levi", totalMinor: b.totalMinor, status: "ACTIVE", supplierRoomId: null });
    expect(rooms[0]!.price).toEqual(b.price);
    await expect(
      createDraft(ctx(), { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, rooms: [{ guests }], leadEmail: "a@b.co", leadPhone: { countryCode: "972", number: "501234567" }, totalMinor: 1 }, { now: NOW }),
    ).rejects.toThrow(/Check the guest names/); // unknown fields (a price) are refused
  });

  it("a draft keeps what the rate includes, as the supplier named it (plan 8f)", async () => {
    const { snapshotId, offers } = await setup();
    const offer = offers.find((o) => o.amenities.length > 0)!;
    const { bookingId } = await draft(snapshotId, offer);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).amenities).toEqual(offer.amenities);
  });

  it("every guest needs a name, and another agency's search gives nothing", async () => {
    const { snapshotId, offers } = await setup();
    const offer = offers[0]!;
    await expect(
      createDraft(ctx(), { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, rooms: [{ guests: guests.slice(0, 2) }], leadEmail: "a@b.co", leadPhone: { countryCode: "972", number: "501234567" } }, { now: NOW }),
    ).rejects.toThrow(/every guest/);
    await expect(draft(snapshotId, offer, "B")).rejects.toThrow(/expired/);
  });

  it("review checks the price again and keeps the old one when it changed", async () => {
    const { snapshotId, offers } = await setup();
    const { bookingId } = await draft(snapshotId, offers[0]!);
    const higher = supplier({
      priceCheck: async () => {
        const price = { ...offers[0]!.price, total: { minor: offers[0]!.price.total.minor + 1_000, currency: "USD" } };
        return { status: "price_changed", bookToken: "fakebk-11-0", price, roomPrices: [price] };
      },
    });
    const review = await prepareReview(ctx(), bookingId, { supplier: higher, now: later(1) });
    expect(review).toMatchObject({ kind: "ready", priceChanged: true, booking: { totalMinor: offers[0]!.price.total.minor + 1_000, previousTotalMinor: offers[0]!.price.total.minor, bookToken: "fakebk-11-0" } });
  });

  it("sold out on review: nothing is held", async () => {
    const { snapshotId, offers } = await setup();
    const { bookingId } = await draft(snapshotId, offers[0]!);
    const review = await prepareReview(ctx(), bookingId, { supplier: supplier({ priceCheck: async () => ({ status: "sold_out" }) }), now: later(1) });
    expect(review.kind).toBe("sold_out");
    expect((await getBalance("A")).heldCents).toBe(0);
  });

  it("a price check that fails is 'unavailable', never a booking", async () => {
    const { snapshotId, offers } = await setup();
    const { bookingId } = await draft(snapshotId, offers[0]!);
    const down = supplier({ priceCheck: async () => { throw new SupplierUnavailable("down", 503); } });
    await expect(prepareReview(ctx(), bookingId, { supplier: down, now: later(1) })).rejects.toThrow(/could not be checked/);
  });
});

describe("booking: book", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("confirmed: the hold becomes a charge, the supplier gets our reference and the lead guest", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier();
    const seen: unknown[] = [];
    const spy = supplier({ book: async (i) => { seen.push(i); return s.book(i, {}); } });
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: spy, now: later(2) })).toEqual({ kind: "confirmed", bookingId });
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ status: "CONFIRMED", supplierItineraryId: `FAKE-${b.reference}`, bookToken: null });
    expect(seen[0]).toMatchObject({ affiliateReferenceId: b.reference, lead: { givenName: "Dana", familyName: "Levi", email: "dana@example.com", phone: { countryCode: "972", number: "501234567" } } });
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
    const events = await db.bookingEvent.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.toStatus)).toEqual(["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"]);
  });

  it("one 'confirmed' email is queued with the confirmation, never twice", async () => {
    const { bookingId, total } = await reviewed();
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(2) });
    await reconcile(bookingId, { supplier: supplier(), now: later(8) });
    const emails = await db.job.findMany({ where: { kind: "email.booking" } });
    expect(emails.map((j) => j.payload)).toEqual([{ bookingId, event: "confirmed" }]);
  });

  it("not enough balance: shows the shortfall, holds nothing, never asks the supplier", async () => {
    const { bookingId, total } = await reviewed(1, 10_000);
    const s = supplier();
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).toEqual({ kind: "insufficient", shortfallMinor: total - 10_000 });
    expect(s.calls.book).toBe(0);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("DRAFT");
    expect(await getBalance("A")).toEqual({ balanceCents: 10_000, heldCents: 0 });
  });

  it("terms not accepted, an old price check, or a different total: review again, nothing held", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier();
    expect((await book(ctx(), bookingId, { acceptedTerms: false, expectedTotalMinor: total }, { supplier: s, now: later(2) })).kind).toBe("review_again");
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(20) })).kind).toBe("review_again");
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total - 1 }, { supplier: s, now: later(2) })).kind).toBe("review_again");
    expect(s.calls.book).toBe(0);
    expect((await getBalance("A")).heldCents).toBe(0);
  });

  it("the supplier refuses: FAILED and the money goes back", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier({ book: async () => { throw new SupplierRequestRejected("sold out", 410); } });
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).kind).toBe("failed");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("FAILED");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
  });

  it("no clear answer: PENDING_CONFIRMATION with the money held, a reconcile job, and a second click never books again", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier({ book: async () => { throw new SupplierOutcomeUnknown("timeout"); } });
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).kind).toBe("pending");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("PENDING_CONFIRMATION");
    // Available balance excludes the hold: the money is reserved, not spent.
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: total });
    expect(await db.job.count({ where: { kind: "booking.reconcile" } })).toBe(2); // safety net + a sooner check
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(3) })).kind).toBe("already");
    expect(s.calls.book).toBe(1);
  });

  it("a crash during the supplier call still ends in a reconciled booking: the job is queued before the call", async () => {
    const { bookingId, total } = await reviewed();
    let jobsDuringCall = -1;
    const s = supplier({
      book: async () => {
        jobsDuringCall = await db.job.count({ where: { kind: "booking.reconcile" } });
        throw new Error("process killed"); // stands in for a crash: nothing after this runs in-request
      },
    });
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) });
    expect(jobsDuringCall).toBe(1);
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(8) })).toBe("confirmed");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("a confirmed booking's safety-net job does nothing", async () => {
    const { bookingId, total } = await reviewed();
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(2) });
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(8) })).toBe("nothing");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("a price check that finishes after the booking never changes the booked price", async () => {
    const { bookingId, total } = await reviewed();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = supplier({
      priceCheck: async () => {
        await gate;
        const current = (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).price as unknown as PriceBreakdown;
        const price = { ...current, total: { minor: total + 5_000, currency: "USD" } };
        return { status: "price_changed", bookToken: "fakebk-11-1", price, roomPrices: [price] };
      },
    });
    const reviewing = prepareReview(ctx(), bookingId, { supplier: slow, now: later(2) });
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(2) });
    release();
    expect((await reviewing).kind).toBe("not_draft");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ totalMinor: total, chargedMinor: total, status: "CONFIRMED" });
  });

  it("a price check that commits between book's read and the hold: review again, nothing held, nothing sent", async () => {
    const { bookingId, total } = await reviewed();
    const higher = supplier({
      priceCheck: async () => {
        const current = (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).price as unknown as PriceBreakdown;
        const price = { ...current, total: { minor: total + 5_000, currency: "USD" } };
        return { status: "price_changed", bookToken: "fakebk-11-1-new", price, roomPrices: [price] };
      },
    });
    // book() reads the booking and its rooms, then (before its hold) a price check commits.
    const original = db.bookingRoom.findMany.bind(db.bookingRoom);
    const spy = vi.spyOn(db.bookingRoom, "findMany").mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const rows = await original(args);
      expect((await prepareReview(ctx(), bookingId, { supplier: higher, now: later(2) })).kind).toBe("ready");
      return rows;
    }) as unknown as typeof db.bookingRoom.findMany);
    const s = supplier();
    try {
      expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).toMatchObject({ kind: "review_again" });
    } finally {
      spy.mockRestore();
    }
    expect(s.calls.book).toBe(0);
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "DRAFT", totalMinor: total + 5_000, holdId: null });
    // Booked at the new price once the agent saw it.
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total + 5_000 }, { supplier: s, now: later(3) })).kind).toBe("confirmed");
  });

  it("two clicks at the same moment: one hold, one supplier call", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier();
    const results = await Promise.all([
      book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) }),
      book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["already", "confirmed"]);
    expect(s.calls.book).toBe(1);
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("another agency cannot book, review or cancel this booking (no IDOR)", async () => {
    const { bookingId, total } = await reviewed();
    const s = supplier();
    await expect(prepareReview(ctx("B", "u-B"), bookingId, { supplier: s, now: later(2) })).rejects.toThrow();
    await expect(book(ctx("B", "u-B"), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).rejects.toThrow();
    await expect(cancel(ctx("B", "u-B"), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(2) })).rejects.toThrow();
    expect(s.calls.book).toBe(0);
  });
});

describe("booking: reconcile", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  async function pending() {
    const r = await reviewed();
    await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier({ book: async () => { throw new SupplierOutcomeUnknown("timeout"); } }), now: later(2) });
    return r;
  }

  it("found at the supplier: CONFIRMED and charged", async () => {
    const { bookingId, total } = await pending();
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(5) })).toBe("confirmed");
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ status: "CONFIRMED", hotelConfirmationId: `H-${b.reference.slice(-6)}` });
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("not found once: wait; not found again 20 minutes later: FAILED and released", async () => {
    const { bookingId } = await pending();
    const none = supplier({ findByAffiliateReference: async () => null });
    expect(await reconcile(bookingId, { supplier: none, now: later(5) })).toBe("retry");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("PENDING_CONFIRMATION");
    expect(await reconcile(bookingId, { supplier: none, now: later(15) })).toBe("retry");
    expect(await reconcile(bookingId, { supplier: none, now: later(26) })).toBe("failed");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
  });

  it("the supplier is down: keep waiting, money stays held", async () => {
    const { bookingId, total } = await pending();
    const down = supplier({ findByAffiliateReference: async () => { throw new SupplierUnavailable("down", 503); } });
    expect(await reconcile(bookingId, { supplier: down, now: later(5) })).toBe("retry");
    expect((await getBalance("A")).heldCents).toBe(total);
    // The safety net queued with the booking, the sooner check after the unclear answer, and this retry.
    expect(await db.job.count({ where: { kind: "booking.reconcile" } })).toBe(3);
  });

  it("gives up after many tries: flagged for an admin, money untouched", async () => {
    const { bookingId, total } = await pending();
    await db.booking.update({ where: { id: bookingId }, data: { reconcileAttempts: 47 } });
    const down = supplier({ findByAffiliateReference: async () => { throw new SupplierUnavailable("down", 503); } });
    expect(await reconcile(bookingId, { supplier: down, now: later(5) })).toBe("retry");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ needsAttention: true, status: "PENDING_CONFIRMATION" });
    expect((await getBalance("A")).heldCents).toBe(total);
  });
});

describe("booking: cancel", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  async function confirmed(offerIndex = 1) {
    const r = await reviewed(offerIndex);
    await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier(), now: later(2) });
    return r;
  }

  it("free cancellation: the full amount is refunded after the supplier confirms", async () => {
    const { bookingId } = await confirmed(1);
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(cancelQuote(b, await db.bookingRoom.findMany({ where: { bookingId } }), later(10))).toEqual({ allowed: true, chargeMinor: 0, refundMinor: b.totalMinor });
    const s = supplier();
    expect(await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).toEqual({ kind: "cancelled" });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", refundMinor: b.totalMinor, cancelChargeMinor: 0 });
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
  });

  it("non-refundable: cancelling charges the whole amount and refunds nothing", async () => {
    const { bookingId, total } = await confirmed(0);
    expect(await cancel(ctx(), bookingId, { expectedChargeMinor: total }, { supplier: supplier(), now: later(10) })).toEqual({ kind: "cancelled" });
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("the supplier refuses: the booking stays confirmed and no money moves", async () => {
    const { bookingId, total } = await confirmed(1);
    const s = supplier({ cancelRoom: async () => { throw new SupplierRequestRejected("no", 400); } });
    expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).kind).toBe("refused");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CONFIRMED");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("no clear answer (202): CANCEL_PENDING, no refund yet; reconcile refunds once the supplier shows it cancelled", async () => {
    const { bookingId, total } = await confirmed(1);
    // The supplier does cancel it, but its answer is not clear to us.
    const s = supplier({ cancelRoom: async (l) => { await new FakeSupplierAdapter().cancelRoom(l); throw new SupplierOutcomeUnknown("202"); } });
    expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).kind).toBe("pending");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CANCEL_PENDING");
    expect((await getBalance("A")).balanceCents).toBe(500_000 - total);
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(15) })).toBe("cancelled");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
    // A second reconcile changes nothing (the refund is written once).
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(20) })).toBe("nothing");
    expect((await getBalance("A")).balanceCents).toBe(500_000);
  });

  it("a booking confirmed by reconciliation (no retrieve link) can still have its cancellation reconciled", async () => {
    const r = await reviewed(1);
    await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier({ book: async () => { throw new SupplierOutcomeUnknown("timeout"); } }), now: later(2) });
    expect(await reconcile(r.bookingId, { supplier: supplier(), now: later(5) })).toBe("confirmed");
    const unclear = supplier({ cancelRoom: async (l) => { await new FakeSupplierAdapter().cancelRoom(l); throw new SupplierOutcomeUnknown("202"); } });
    expect((await cancel(ctx(), r.bookingId, { expectedChargeMinor: 0 }, { supplier: unclear, now: later(10) })).kind).toBe("pending");
    const jobs = await db.job.count({ where: { kind: "booking.reconcile" } });
    expect(jobs).toBeGreaterThan(2); // the cancellation got its own job (never skipped as a repeat)
    expect(await reconcile(r.bookingId, { supplier: supplier(), now: later(16) })).toBe("cancelled");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
  });

  it("a cancellation still 'booked' at the supplier is put back only after 30 minutes", async () => {
    const { bookingId, total } = await confirmed(1);
    const unclear = supplier({ cancelRoom: async () => { throw new SupplierOutcomeUnknown("202"); } });
    await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: unclear, now: later(10) });
    const stillBooked = supplier({ retrieve: async () => ({ itineraryId: "x", rooms: [{ id: "room-1", status: "booked", hotelConfirmationId: null, cancelLink: "fake-cancel:x", givenName: null, familyName: null }] }) });
    expect(await reconcile(bookingId, { supplier: stillBooked, now: later(15) })).toBe("retry");
    expect(await reconcile(bookingId, { supplier: stillBooked, now: later(45) })).toBe("restored");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CONFIRMED");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
  });

  it("a charge different from what the agent saw is refused", async () => {
    const { bookingId } = await confirmed(1);
    const s = supplier();
    expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 5 }, { supplier: s, now: later(10) })).kind).toBe("not_allowed");
    expect(s.calls.cancelRoom).toBe(0);
  });
});

// Plan 10: several rooms in one booking (allowed while the fake supplier is on). The fake
// prices room 1 as one room always cost; each other room 4 dollars a night less for each adult
// and 2 for each child fewer than room 1.
describe("booking: several rooms", () => {
  const TWO_ROOMS = [{ adults: 2, childAges: [7] }, { adults: 1, childAges: [] }];
  const yossi = { givenName: "Yossi", familyName: "Cohen" };
  const twoRoomGuests = [{ guests }, { guests: [yossi] }];

  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function search() {
    const { offers: oneRoom } = await setup();
    const { snapshotId } = await startSearch(ctx(), { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: TWO_ROOMS }, { adapter: supplier(), now: NOW });
    const offers = (await db.searchHotel.findFirstOrThrow({ where: { snapshotId } })).offers as unknown as Offer[];
    return { snapshotId, offers, oneRoom };
  }

  const base = (snapshotId: string, offer: Offer) => ({ snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, leadEmail: "dana@example.com", leadPhone: { countryCode: "972", number: "501234567" } });

  async function drafted(offerIndex = 1) {
    const found = await search();
    const offer = found.offers[offerIndex]!;
    const { bookingId } = await createDraft(ctx(), { ...base(found.snapshotId, offer), rooms: twoRoomGuests }, { now: NOW });
    return { ...found, offer, bookingId };
  }

  async function reviewedRooms(offerIndex = 1) {
    const d = await drafted(offerIndex);
    const review = await prepareReview(ctx(), d.bookingId, { supplier: supplier(), now: later(1) });
    if (review.kind !== "ready") throw new Error("not ready");
    return { ...d, total: review.booking.totalMinor };
  }

  const roomsOf = (bookingId: string) => db.bookingRoom.findMany({ where: { bookingId }, orderBy: { index: "asc" } });

  it("a draft of two rooms keeps each room's guests and price; the rooms add up to the booking", async () => {
    const { bookingId, offer, oneRoom } = await drafted();
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ adults: 3, childAges: [7], leadGivenName: "Dana", leadFamilyName: "Levi", totalMinor: offer.price.total.minor });
    expect(b.guests).toEqual([...guests, yossi]); // every room's guests, in room order
    const rooms = await roomsOf(bookingId);
    expect(rooms.map((r) => ({ index: r.index, adults: r.adults, childAges: r.childAges, guests: r.guests, givenName: r.givenName, familyName: r.familyName, status: r.status }))).toEqual([
      { index: 0, adults: 2, childAges: [7], guests, givenName: "Dana", familyName: "Levi", status: "ACTIVE" },
      { index: 1, adults: 1, childAges: [], guests: [yossi], givenName: "Yossi", familyName: "Cohen", status: "ACTIVE" },
    ]);
    // Room 1 is priced as the same guests alone; room 2 has 1 adult and 1 child fewer: 6 dollars a night less.
    const same = oneRoom.find((o) => o.rateId === offer.rateId)!;
    expect(rooms[0]!.totalMinor).toBe(same.price.total.minor);
    const nightly = (same.price.lines.find((l) => l.kind === "room_rate")!.amount.minor) / 2 - 600;
    expect(rooms[1]!.totalMinor).toBe(nightly * 2 + Math.floor((nightly * 2) / 8));
    expect(rooms[0]!.totalMinor + rooms[1]!.totalMinor).toBe(b.totalMinor);
    expect(rooms.map((r) => r.price)).toEqual(offer.roomPrices);
  });

  it("each room needs exactly its own guests, and every searched room must be there", async () => {
    const { snapshotId, offers } = await search();
    const input = base(snapshotId, offers[1]!);
    const wrong = [
      [{ guests: guests.slice(0, 2) }, { guests: [yossi, guests[2]!] }], // 4 guests in all, but 2 and 2
      [{ guests: [...guests, yossi] }], // one room for a two-room search
      [{ guests }, { guests: [yossi] }, { guests: [yossi] }], // one room too many
    ];
    for (const rooms of wrong) await expect(createDraft(ctx(), { ...input, rooms }, { now: NOW })).rejects.toThrow(/every guest/);
    await expect(createDraft(ctx(), { ...input, guests: [...guests, yossi] }, { now: NOW })).rejects.toThrow(/Check the guest names/); // the old shape is refused
    expect(await db.booking.count()).toBe(0);
    expect(await db.bookingRoom.count()).toBe(0);
  });

  it("with the real supplier a several-room draft is refused", async () => {
    const { snapshotId, offers } = await search();
    vi.stubEnv("SUPPLIER_MODE", "expedia");
    await expect(createDraft(ctx(), { ...base(snapshotId, offers[1]!), rooms: twoRoomGuests }, { now: NOW })).rejects.toThrow("Several rooms are not available yet.");
    expect(await db.booking.count()).toBe(0);
  });

  it("a several-room search cannot book a quote's destination (quotes are one room)", async () => {
    const { snapshotId, offers } = await search();
    await expect(createDraft(ctx(), { ...base(snapshotId, offers[1]!), rooms: twoRoomGuests, quoteStayId: "c".repeat(25) }, { now: NOW })).rejects.toThrow(/not the dates or hotel of this quote/);
  });

  it("review checks every room; a new price updates the rooms with the booking, and they still add up", async () => {
    const { bookingId, offer } = await drafted();
    const asked: unknown[] = [];
    const higher = supplier({
      priceCheck: async (ref) => {
        asked.push(ref.occupancies);
        const roomPrices = offer.roomPrices.map((p, i) => ({ ...p, total: { minor: p.total.minor + (i === 1 ? 500 : 0), currency: "USD" } }));
        const price = { ...offer.price, total: { minor: offer.price.total.minor + 500, currency: "USD" } };
        return { status: "price_changed", bookToken: "fakebk-11-1", price, roomPrices };
      },
    });
    const review = await prepareReview(ctx(), bookingId, { supplier: higher, now: later(1) });
    expect(asked).toEqual([TWO_ROOMS]);
    expect(review).toMatchObject({ kind: "ready", priceChanged: true, booking: { totalMinor: offer.price.total.minor + 500, previousTotalMinor: offer.price.total.minor } });
    const rooms = await roomsOf(bookingId);
    expect(rooms.map((r) => r.totalMinor)).toEqual([offer.roomPrices[0]!.total.minor, offer.roomPrices[1]!.total.minor + 500]);
    expect((rooms[1]!.price as unknown as PriceBreakdown).total.minor).toBe(offer.roomPrices[1]!.total.minor + 500);
  });

  it("a price check whose rooms do not add up, or miss a room, is not used: nothing is written", async () => {
    const { bookingId, offer } = await drafted();
    const bad = [
      { status: "available" as const, bookToken: "fakebk-11-1", price: offer.price, roomPrices: [offer.roomPrices[0]!] },
      { status: "available" as const, bookToken: "fakebk-11-1", price: offer.price, roomPrices: [offer.roomPrices[0]!, { ...offer.roomPrices[1]!, total: { minor: 1, currency: "USD" } }] },
    ];
    for (const result of bad) {
      await expect(prepareReview(ctx(), bookingId, { supplier: supplier({ priceCheck: async () => result }), now: later(1) })).rejects.toThrow(/could not be checked/);
    }
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ bookToken: null, priceCheckedAt: null, totalMinor: offer.price.total.minor });
  });

  it("book sends each room's main guest in room order, holds the total once, and stores each room's supplier details", async () => {
    const { bookingId, total } = await reviewedRooms();
    const sent: { rooms: unknown; specialRequest?: string }[] = [];
    const s = supplier({ book: async (i) => { sent.push(i); return new FakeSupplierAdapter().book(i); } });
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).toEqual({ kind: "confirmed", bookingId });
    expect(sent[0]!.rooms).toEqual([{ givenName: "Dana", familyName: "Levi" }, { givenName: "Yossi", familyName: "Cohen" }]);
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
    expect(await db.ledgerEntry.count({ where: { type: "CHARGE" } })).toBe(1);
    const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(b).toMatchObject({ status: "CONFIRMED", needsAttention: false });
    const ref = b.reference;
    expect((await roomsOf(bookingId)).map((r) => [r.supplierRoomId, r.hotelConfirmationId, r.cancelLink])).toEqual([
      ["room-1", `H-${ref.slice(-6)}`, `fake-cancel:${ref}`],
      ["room-2", `H-${ref.slice(-6)}-2`, `fake-cancel:${ref}:2`],
    ]);
  });

  it("a retrieve with the main guests swapped flags the booking for an admin and stores nothing for those rooms", async () => {
    const { bookingId, total } = await reviewedRooms();
    const swapped = supplier({
      retrieve: async () => ({
        itineraryId: "x",
        rooms: [
          { id: "s-1", status: "booked", hotelConfirmationId: "H1", cancelLink: "fake-cancel:1", givenName: "Yossi", familyName: "Cohen" },
          { id: "s-2", status: "booked", hotelConfirmationId: "H2", cancelLink: "fake-cancel:2", givenName: "Dana", familyName: "Levi" },
        ],
      }),
    });
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: swapped, now: later(2) })).kind).toBe("confirmed");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", needsAttention: true });
    expect((await roomsOf(bookingId)).map((r) => [r.supplierRoomId, r.hotelConfirmationId, r.cancelLink])).toEqual([[null, null, null], [null, null, null]]);
    expect((await db.job.findMany({ where: { kind: "email.booking" } })).map((j) => j.payload)).toContainEqual({ bookingId, event: "needs_attention" });
  });

  it("names match ignoring case and spaces; only the room whose name differs is left out", async () => {
    const { bookingId, total } = await reviewedRooms();
    const oneWrong = supplier({
      retrieve: async () => ({
        itineraryId: "x",
        rooms: [
          { id: "s-1", status: "booked", hotelConfirmationId: "H1", cancelLink: "fake-cancel:1", givenName: " DANA ", familyName: "levi" },
          { id: "s-2", status: "booked", hotelConfirmationId: "H2", cancelLink: "fake-cancel:2", givenName: "Someone", familyName: "Else" },
        ],
      }),
    });
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: oneWrong, now: later(2) });
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).needsAttention).toBe(true);
    expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual(["s-1", null]);
  });

  it("a retrieve with another number of rooms flags the booking and stores nothing", async () => {
    const { bookingId, total } = await reviewedRooms();
    const one = supplier({ retrieve: async () => ({ itineraryId: "x", rooms: [{ id: "s-1", status: "booked", hotelConfirmationId: "H1", cancelLink: "fake-cancel:1", givenName: "Dana", familyName: "Levi" }] }) });
    await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: one, now: later(2) });
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).needsAttention).toBe(true);
    expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual([null, null]);
  });

  it("a retrieve that fails never fails the booking; the safety-net job fills the rooms later, once", async () => {
    const { bookingId, total } = await reviewedRooms();
    const down = supplier({ retrieve: async () => { throw new SupplierUnavailable("down", 503); } });
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: down, now: later(2) })).kind).toBe("confirmed");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", needsAttention: false });
    expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual([null, null]);
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(8) })).toBe("nothing");
    expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual(["room-1", "room-2"]);
    // Filled rooms are kept as they are: a later retrieve with other details changes nothing, and
    // nothing is asked when every room is filled.
    let asked = 0;
    const other = supplier({ retrieve: async (): Promise<RetrievedItinerary> => { asked++; return { itineraryId: "x", rooms: [] }; } });
    await fillRoomsFromSupplier(bookingId, { supplier: other });
    expect(asked).toBe(0);
    expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual(["room-1", "room-2"]);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).needsAttention).toBe(false);
  });

  it("rooms that do not add up to the booking's total, or a missing room: review again, nothing held, nothing sent", async () => {
    const { bookingId, total } = await reviewedRooms();
    const s = supplier();
    const [first] = await roomsOf(bookingId);
    await db.bookingRoom.update({ where: { id: first!.id }, data: { totalMinor: first!.totalMinor - 1 } });
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(2) })).kind).toBe("review_again");
    await db.bookingRoom.update({ where: { id: first!.id }, data: { totalMinor: first!.totalMinor } });
    await db.bookingRoom.deleteMany({ where: { bookingId, index: 1 } });
    await db.booking.update({ where: { id: bookingId }, data: { totalMinor: first!.totalMinor } }); // a sum that holds, but a room short
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: first!.totalMinor }, { supplier: s, now: later(2) })).kind).toBe("review_again");
    expect(s.calls.book).toBe(0);
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("DRAFT");
  });

  describe("reconcile of a booking with no clear answer", () => {
    async function pendingRooms() {
      const r = await reviewedRooms();
      await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier({ book: async () => { throw new SupplierOutcomeUnknown("timeout"); } }), now: later(2) });
      const reference = (await db.booking.findUniqueOrThrow({ where: { id: r.bookingId } })).reference;
      return { ...r, reference };
    }
    const room = (n: number, status: "booked" | "cancelled" | "pending", name = n === 1 ? { givenName: "Dana", familyName: "Levi" } : yossi) => ({ id: `s-${n}`, status, hotelConfirmationId: `H${n}`, cancelLink: `fake-cancel:${n}`, ...name });
    const at = (rooms: RetrievedItinerary["rooms"]) => supplier({ findByAffiliateReference: async () => ({ itineraryId: "IT-1", rooms }) });

    it("every room booked: CONFIRMED, charged once, each room's details stored", async () => {
      const { bookingId, total } = await pendingRooms();
      expect(await reconcile(bookingId, { supplier: at([room(1, "booked"), room(2, "booked")]), now: later(5) })).toBe("confirmed");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", supplierItineraryId: "IT-1", needsAttention: false });
      expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
      expect((await roomsOf(bookingId)).map((r) => [r.supplierRoomId, r.hotelConfirmationId])).toEqual([["s-1", "H1"], ["s-2", "H2"]]);
    });

    it("a room cancelled or missing at the supplier: flagged for an admin, still pending, money held (never failed)", async () => {
      const { bookingId, total } = await pendingRooms();
      for (const rooms of [[room(1, "booked"), room(2, "cancelled")], [room(1, "booked")]]) {
        expect(await reconcile(bookingId, { supplier: at(rooms), now: later(5) })).toBe("retry");
        expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "PENDING_CONFIRMATION", needsAttention: true });
        expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: total });
      }
      expect((await roomsOf(bookingId)).map((r) => r.supplierRoomId)).toEqual([null, null]);
    });

    it("a room still pending at the supplier: wait and look again", async () => {
      const { bookingId, total } = await pendingRooms();
      expect(await reconcile(bookingId, { supplier: at([room(1, "booked"), room(2, "pending")]), now: later(5) })).toBe("retry");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "PENDING_CONFIRMATION", needsAttention: false });
      expect((await getBalance("A")).heldCents).toBe(total);
      expect(await reconcile(bookingId, { supplier: at([room(1, "booked"), room(2, "booked")]), now: later(10) })).toBe("confirmed");
    });
  });

  // Cancelling cancels every room: one supplier call per room, with that room's own link, in
  // room order, and one refund once every room is cancelled.
  describe("cancel", () => {
    async function confirmedRooms() {
      const r = await reviewedRooms();
      await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier(), now: later(2) });
      const booking = await db.booking.findUniqueOrThrow({ where: { id: r.bookingId } });
      expect(booking.status).toBe("CONFIRMED");
      return { ...r, booking, reference: booking.reference, link1: `fake-cancel:${booking.reference}`, link2: `fake-cancel:${booking.reference}:2` };
    }
    // Room 2's cancel gets no clear answer, and the supplier has not done it (yet).
    const room2Unclear = (sent: string[] = []) =>
      supplier({
        cancelRoom: async (link) => {
          sent.push(link);
          if (link.endsWith(":2")) throw new SupplierOutcomeUnknown("202");
          return new FakeSupplierAdapter().cancelRoom(link);
        },
      });
    const refunds = (bookingRef: string) => db.ledgerEntry.findMany({ where: { type: "REFUND", bookingRef } });
    const roomEvents = async (bookingId: string) => (await db.bookingEvent.findMany({ where: { bookingId, reason: { contains: "room", mode: "insensitive" } }, orderBy: { createdAt: "asc" } })).map((e) => e.reason);

    it("calls the supplier once per room with each room's own link; both rooms cancelled, one refund, booking cancelled", async () => {
      const { bookingId, booking, link1, link2 } = await confirmedRooms();
      const quote = cancelQuote(booking, await roomsOf(bookingId), later(10));
      expect(quote).toEqual({ allowed: true, chargeMinor: 0, refundMinor: booking.totalMinor });
      const sent: string[] = [];
      const s = supplier({ cancelRoom: async (link) => { sent.push(link); return new FakeSupplierAdapter().cancelRoom(link); } });
      expect(await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).toEqual({ kind: "cancelled" });
      expect(sent).toEqual([link1, link2]);
      const rooms = await roomsOf(bookingId);
      expect(rooms.map((r) => r.status)).toEqual(["CANCELLED", "CANCELLED"]);
      expect(rooms.every((r) => r.cancelledAt !== null)).toBe(true);
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", cancelChargeMinor: 0, refundMinor: booking.totalMinor });
      expect((await refunds(booking.reference)).map((e) => e.amountCents)).toEqual([booking.totalMinor]);
      expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
      // Each room's cancellation is in the booking's audit trail, under the booking's own state.
      const events = await db.bookingEvent.findMany({ where: { bookingId, reason: { contains: "Room" } }, orderBy: { createdAt: "asc" } });
      expect(events.map((e) => [e.fromStatus, e.toStatus, e.reason])).toEqual([
        ["CANCEL_PENDING", "CANCEL_PENDING", "Room 1 of 2 cancelled at the supplier"],
        ["CANCEL_PENDING", "CANCEL_PENDING", "Room 2 of 2 cancelled at the supplier"],
      ]);
      expect((await db.job.findMany({ where: { kind: "email.booking" } })).map((j) => j.payload)).toContainEqual({ bookingId, event: "cancelled" });
    });

    it("room 1 cancelled and room 2's answer unclear: CANCEL_PENDING, no refund; reconcile finishes with one refund once the supplier shows both cancelled", async () => {
      const { bookingId, booking, link1, link2 } = await confirmedRooms();
      const sent: string[] = [];
      expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: room2Unclear(sent), now: later(10) })).kind).toBe("pending");
      expect(sent).toEqual([link1, link2]);
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CANCEL_PENDING");
      expect((await roomsOf(bookingId)).map((r) => r.status)).toEqual(["CANCELLED", "ACTIVE"]);
      expect(await refunds(booking.reference)).toHaveLength(0);
      // The supplier (the fake) has room 1 cancelled and room 2 still booked.
      const theirs = await new FakeSupplierAdapter().retrieve({ retrieve: `fake-retrieve:${booking.reference}` });
      expect(theirs.rooms.map((r) => r.status)).toEqual(["cancelled", "booked"]);

      // Still booked a few minutes later: wait, and never send room 2's cancel again.
      const s = supplier();
      expect(await reconcile(bookingId, { supplier: s, now: later(15) })).toBe("retry");
      expect(s.calls.cancelRoom).toBe(0);
      // The supplier finishes room 2's cancellation; the next check refunds once.
      await new FakeSupplierAdapter().cancelRoom(link2);
      expect(await reconcile(bookingId, { supplier: s, now: later(20) })).toBe("cancelled");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", refundMinor: booking.totalMinor });
      expect((await roomsOf(bookingId)).map((r) => r.status)).toEqual(["CANCELLED", "CANCELLED"]);
      expect(await reconcile(bookingId, { supplier: s, now: later(25) })).toBe("nothing");
      expect(s.calls.cancelRoom).toBe(0);
      expect((await refunds(booking.reference)).map((e) => e.amountCents)).toEqual([booking.totalMinor]);
      expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
      expect(await roomEvents(bookingId)).toEqual(["Room 1 of 2 cancelled at the supplier", "Reconciled: room 2 of 2 cancelled at the supplier"]);
    });

    it("a retry of the cancel, or a second check, never cancels a room twice", async () => {
      const { bookingId, total } = await confirmedRooms();
      const sent: string[] = [];
      const unclear = room2Unclear(sent);
      await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: unclear, now: later(10) });
      expect(await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: unclear, now: later(11) })).toMatchObject({ kind: "not_allowed" });
      expect(await reconcile(bookingId, { supplier: unclear, now: later(12) })).toBe("retry");
      expect(await reconcile(bookingId, { supplier: unclear, now: later(13) })).toBe("retry");
      expect(sent).toHaveLength(2); // room 1 once, room 2 once
      expect(await roomEvents(bookingId)).toEqual(["Room 1 of 2 cancelled at the supplier"]);
      expect((await getBalance("A")).balanceCents).toBe(500_000 - total);
    });

    it("two cancels at the same moment: each room is sent once", async () => {
      const { bookingId } = await confirmedRooms();
      const s = supplier();
      const results = await Promise.all([
        cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) }),
        cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["cancelled", "not_allowed"]);
      expect(s.calls.cancelRoom).toBe(2);
      expect(await db.ledgerEntry.count({ where: { type: "REFUND" } })).toBe(1);
    });

    it("rooms after an unclear answer are left to reconcile, which sends them once the rooms before them are cancelled", async () => {
      const { bookingId, booking, link1, link2 } = await confirmedRooms();
      const sent: string[] = [];
      const room1Unclear = supplier({ cancelRoom: async (link) => { sent.push(link); if (!link.endsWith(":2")) throw new SupplierOutcomeUnknown("202"); return new FakeSupplierAdapter().cancelRoom(link); } });
      expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: room1Unclear, now: later(10) })).kind).toBe("pending");
      expect(sent).toEqual([link1]); // the loop stopped at room 1
      // Room 1 not cancelled at the supplier yet: wait, send nothing.
      expect(await reconcile(bookingId, { supplier: room1Unclear, now: later(15) })).toBe("retry");
      expect(sent).toEqual([link1]);
      // The supplier finishes room 1: the check marks it and sends room 2, once.
      await new FakeSupplierAdapter().cancelRoom(link1);
      expect(await reconcile(bookingId, { supplier: room1Unclear, now: later(20) })).toBe("cancelled");
      expect(sent).toEqual([link1, link2]);
      expect((await refunds(booking.reference)).map((e) => e.amountCents)).toEqual([booking.totalMinor]);
      expect(await roomEvents(bookingId)).toEqual(["Reconciled: room 1 of 2 cancelled at the supplier", "Room 2 of 2 cancelled at the supplier"]);
    });

    it("the charge is each room's own charge, summed; the refund is the rest of what was paid", async () => {
      const { bookingId, booking } = await confirmedRooms();
      const rooms = await roomsOf(bookingId);
      const inPenalty = new Date("2027-04-08T10:00:00.000Z"); // after free cancellation ends, before check-in
      const [penalty] = booking.cancelPenalties as unknown as { amount: { minor: number } }[];
      // The fake's penalty is one room's base nightly price, whatever the room: each room is charged it (at most its own total).
      const expected = rooms.reduce((n, r) => n + Math.min(penalty!.amount.minor, r.totalMinor), 0);
      expect(expected).toBeGreaterThan(penalty!.amount.minor);
      const paid = booking.chargedMinor!;
      expect(cancelQuote(booking, rooms, inPenalty)).toEqual({ allowed: true, chargeMinor: expected, refundMinor: paid - expected });
      // The browser's number must be the server's sum: one room's charge is refused.
      const s = supplier();
      expect((await cancel(ctx(), bookingId, { expectedChargeMinor: penalty!.amount.minor }, { supplier: s, now: inPenalty })).kind).toBe("not_allowed");
      expect(s.calls.cancelRoom).toBe(0);
      expect(await cancel(ctx(), bookingId, { expectedChargeMinor: expected }, { supplier: s, now: inPenalty })).toEqual({ kind: "cancelled" });
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", cancelChargeMinor: expected, refundMinor: paid - expected });
      expect((await refunds(booking.reference)).map((e) => e.amountCents)).toEqual([paid - expected]);
      expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - expected, heldCents: 0 });
    });

    it("rooms that do not add up to what was paid cannot be cancelled online", async () => {
      const { bookingId, booking } = await confirmedRooms();
      const rooms = await roomsOf(bookingId);
      expect(cancelQuote(booking, rooms.slice(0, 1), later(10))).toMatchObject({ allowed: false, reason: expect.stringMatching(/Apolles support/) });
      expect(cancelQuote(booking, [], later(10))).toMatchObject({ allowed: false });
    });

    it("the supplier refuses room 1: nothing was cancelled, so the booking is confirmed again and no money moves", async () => {
      const { bookingId, total } = await confirmedRooms();
      const s = supplier({ cancelRoom: async () => { throw new SupplierRequestRejected("no", 400); } });
      expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).kind).toBe("refused");
      expect(s.calls.cancelRoom).toBe(1);
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED", cancelChargeMinor: null });
      expect((await roomsOf(bookingId)).map((r) => [r.status, r.cancelRequestedAt])).toEqual([["ACTIVE", null], ["ACTIVE", null]]);
      expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - total, heldCents: 0 });
      // It can be cancelled again later, every room sent afresh.
      expect(await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: supplier(), now: later(20) })).toEqual({ kind: "cancelled" });
    });

    it("the supplier refuses room 2 after room 1 was cancelled: still cancelling, flagged for an admin, nothing refunded", async () => {
      const { bookingId, booking, total } = await confirmedRooms();
      const s = supplier({ cancelRoom: async (link) => { if (link.endsWith(":2")) throw new SupplierRequestRejected("no", 400); return new FakeSupplierAdapter().cancelRoom(link); } });
      expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).kind).toBe("part_refused");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCEL_PENDING", needsAttention: true });
      expect(await roomEvents(bookingId)).toEqual(["Room 1 of 2 cancelled at the supplier", "Room 2 of 2: Supplier refused the cancellation: no"]);
      expect((await roomsOf(bookingId)).map((r) => r.status)).toEqual(["CANCELLED", "ACTIVE"]);
      expect(await refunds(booking.reference)).toHaveLength(0);
      expect((await getBalance("A")).balanceCents).toBe(500_000 - total);
      expect((await db.job.findMany({ where: { kind: "email.booking" } })).map((j) => j.payload)).toContainEqual({ bookingId, event: "needs_attention" });
      // The checks never send it again, and never put a part-cancelled booking back.
      expect(await reconcile(bookingId, { supplier: s, now: later(50) })).toBe("retry");
      expect(s.calls.cancelRoom).toBe(2);
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CANCEL_PENDING");
    });

    it("room 2 still booked 30 minutes after its cancel, with room 1 cancelled: never put back, flagged for an admin", async () => {
      const { bookingId, booking } = await confirmedRooms();
      await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: room2Unclear(), now: later(10) });
      const s = supplier();
      expect(await reconcile(bookingId, { supplier: s, now: later(45) })).toBe("retry");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCEL_PENDING", needsAttention: true });
      expect(s.calls.cancelRoom).toBe(0);
      expect(await refunds(booking.reference)).toHaveLength(0);
    });

    it("rooms without their cancel link: one retrieve fills them before anything is sent; still missing: nothing sent, still confirmed", async () => {
      const r = await reviewedRooms();
      const down = supplier({ retrieve: async () => { throw new SupplierUnavailable("down", 503); } });
      await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: down, now: later(2) });
      expect((await roomsOf(r.bookingId)).map((x) => x.cancelLink)).toEqual([null, null]);
      // The supplier still cannot be reached: nothing is sent, the booking stays as it is.
      expect((await cancel(ctx(), r.bookingId, { expectedChargeMinor: 0 }, { supplier: down, now: later(10) })).kind).toBe("not_allowed");
      expect(down.calls.cancelRoom).toBe(0);
      expect((await db.booking.findUniqueOrThrow({ where: { id: r.bookingId } })).status).toBe("CONFIRMED");
      // Reachable again: the links are filled, then every room is cancelled.
      const s = supplier();
      expect(await cancel(ctx(), r.bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(11) })).toEqual({ kind: "cancelled" });
      expect(s.calls.cancelRoom).toBe(2);
    });
  });
});

vi.setConfig({ testTimeout: 30_000 });

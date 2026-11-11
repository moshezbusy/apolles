import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { startSearch } from "@/server/search/search";
import { SupplierOutcomeUnknown, SupplierRequestRejected, SupplierUnavailable } from "@/server/supplier/expedia/client";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import type { BookingSupplier, Offer, SupplierAdapter } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { book, cancel, cancelQuote, createDraft, prepareReview, reconcile } from "./service";

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
  const input = { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", adults: 2, childAges: [7] };
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
    { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, guests, leadEmail: "Dana@Example.com", leadPhone: { countryCode: "972", number: "501234567" } },
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
    await expect(
      createDraft(ctx(), { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, guests, leadEmail: "a@b.co", leadPhone: { countryCode: "972", number: "501234567" }, totalMinor: 1 }, { now: NOW }),
    ).rejects.toThrow(/Check the guest names/); // unknown fields (a price) are refused
  });

  it("every guest needs a name, and another agency's search gives nothing", async () => {
    const { snapshotId, offers } = await setup();
    const offer = offers[0]!;
    await expect(
      createDraft(ctx(), { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, guests: guests.slice(0, 2), leadEmail: "a@b.co", leadPhone: { countryCode: "972", number: "501234567" } }, { now: NOW }),
    ).rejects.toThrow(/every guest/);
    await expect(draft(snapshotId, offer, "B")).rejects.toThrow(/expired/);
  });

  it("review checks the price again and keeps the old one when it changed", async () => {
    const { snapshotId, offers } = await setup();
    const { bookingId } = await draft(snapshotId, offers[0]!);
    const higher = supplier({
      priceCheck: async () => ({ status: "price_changed", bookToken: "fakebk-11-0", price: { ...offers[0]!.price, total: { minor: offers[0]!.price.total.minor + 1_000, currency: "USD" } } }),
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
    expect(await db.job.count({ where: { kind: "booking.reconcile" } })).toBe(1);
    expect((await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: s, now: later(3) })).kind).toBe("already");
    expect(s.calls.book).toBe(1);
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
    expect(await db.job.count({ where: { kind: "booking.reconcile" } })).toBe(2);
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
    expect(cancelQuote(b, later(10))).toEqual({ allowed: true, chargeMinor: 0, refundMinor: b.totalMinor });
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
    const s = supplier({ cancelRoom: async () => { throw new SupplierOutcomeUnknown("202"); } });
    expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 0 }, { supplier: s, now: later(10) })).kind).toBe("pending");
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CANCEL_PENDING");
    expect((await getBalance("A")).balanceCents).toBe(500_000 - total);
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(15) })).toBe("cancelled");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
    // A second reconcile changes nothing (the refund is written once).
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(20) })).toBe("nothing");
    expect((await getBalance("A")).balanceCents).toBe(500_000);
  });

  it("a charge different from what the agent saw is refused", async () => {
    const { bookingId } = await confirmed(1);
    const s = supplier();
    expect((await cancel(ctx(), bookingId, { expectedChargeMinor: 5 }, { supplier: s, now: later(10) })).kind).toBe("not_allowed");
    expect(s.calls.cancelRoom).toBe(0);
  });
});

vi.setConfig({ testTimeout: 30_000 });

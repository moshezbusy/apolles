import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { startSearch } from "@/server/search/search";
import { SupplierOutcomeUnknown } from "@/server/supplier/expedia/client";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import type { BookingSupplier, Offer, SupplierAdapter } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import {
  BookingInputInvalid,
  adminCancelForAgent,
  adminCheckWithSupplier,
  adminMarkResolved,
  adminRecordSupplierRefund,
  adminReleaseHold,
  book,
  createDraft,
  flagForAdmin,
  prepareReview,
} from "./service";

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

const ADMIN = "admin-1";

async function confirmed() {
  const r = await reviewed(1);
  await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: supplier(), now: later(2) });
  expect((await db.booking.findUniqueOrThrow({ where: { id: r.bookingId } })).status).toBe("CONFIRMED");
  return r;
}

async function pending() {
  const r = await reviewed(1);
  const unclear = supplier({ book: async () => { throw new SupplierOutcomeUnknown("timeout"); } });
  expect((await book(ctx(), r.bookingId, { acceptedTerms: true, expectedTotalMinor: r.total }, { supplier: unclear, now: later(2) })).kind).toBe("pending");
  return r;
}

const audits = (action: string) => db.auditLog.findMany({ where: { action } });
const emails = async (bookingId: string) =>
  (await db.job.findMany({ where: { kind: "email.booking" } }))
    .map((job) => job.payload as { bookingId: string; event: string })
    .filter((p) => p.bookingId === bookingId)
    .map((p) => p.event);

describe("admin actions on a booking", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.user.create({ data: { id: ADMIN, email: "admin@test.local", name: "Admin", role: "ADMIN" } });
  });

  describe("check with the supplier now", () => {
    it("queues one immediate check with an audit row; a second click finds it queued", async () => {
      const { bookingId } = await confirmed();
      const before = await db.job.count({ where: { kind: "booking.reconcile" } });
      expect(await adminCheckWithSupplier(ADMIN, bookingId, NOW)).toBe("queued");
      expect(await adminCheckWithSupplier(ADMIN, bookingId, NOW)).toBe("already_queued");
      expect(await db.job.count({ where: { kind: "booking.reconcile" } })).toBe(before + 1);
      expect(await audits("booking.supplier-check")).toHaveLength(1);
    });

    it("a draft has nothing to check", async () => {
      const { bookingId } = await reviewed(1);
      expect(await adminCheckWithSupplier(ADMIN, bookingId)).toBe("not_checkable");
      expect(await audits("booking.supplier-check")).toHaveLength(0);
    });
  });

  describe("mark resolved", () => {
    it("clears needs attention once, keeps the note in the trail, with an audit row; a note is required", async () => {
      const { bookingId } = await confirmed();
      await db.$transaction((tx) => flagForAdmin(tx, bookingId, "Something to check"));
      await expect(adminMarkResolved(ADMIN, bookingId, "  ")).rejects.toThrow(BookingInputInvalid);
      expect(await adminMarkResolved(ADMIN, bookingId, "Checked with Expedia: all fine")).toBe("resolved");
      expect(await adminMarkResolved(ADMIN, bookingId, "Checked with Expedia: all fine")).toBe("not_flagged");
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).needsAttention).toBe(false);
      const note = await db.bookingEvent.findFirstOrThrow({ where: { bookingId, reason: { startsWith: "Resolved by an admin" } } });
      expect(note).toMatchObject({ actorUserId: ADMIN, fromStatus: "CONFIRMED", toStatus: "CONFIRMED", reason: "Resolved by an admin: Checked with Expedia: all fine" });
      expect(await audits("booking.resolve")).toHaveLength(1);
    });
  });

  describe("cancel for the agent", () => {
    it("the agent's cancellation with the same charge rules, named in the trail, the refund in the wallet, the support email", async () => {
      const { bookingId, total } = await confirmed();
      const balance = (await getBalance("A")).balanceCents;
      expect(await adminCancelForAgent(ADMIN, bookingId, { expectedChargeMinor: 0 }, { supplier: supplier(), now: later(10) })).toEqual({ kind: "cancelled" });
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CANCELLED", refundMinor: total, cancelChargeMinor: 0 });
      expect((await getBalance("A")).balanceCents).toBe(balance + total);
      expect(await db.bookingEvent.findFirst({ where: { bookingId, toStatus: "CANCEL_PENDING" } })).toMatchObject({ actorUserId: ADMIN, reason: "An admin cancelled the booking for the agent" });
      expect(await emails(bookingId)).toContain("cancelled_by_support");
      expect(await emails(bookingId)).not.toContain("cancelled");
      expect(await audits("booking.cancel-for-agent")).toHaveLength(1);
      // A second click: already cancelled, nothing more refunded.
      expect((await adminCancelForAgent(ADMIN, bookingId, { expectedChargeMinor: 0 }, { supplier: supplier(), now: later(11) })).kind).toBe("not_allowed");
      expect((await getBalance("A")).balanceCents).toBe(balance + total);
    });

    it("a charge that is not the one the admin was shown is refused before anything is sent", async () => {
      const { bookingId } = await confirmed();
      const s = supplier();
      expect(await adminCancelForAgent(ADMIN, bookingId, { expectedChargeMinor: 1 }, { supplier: s, now: later(10) })).toMatchObject({ kind: "not_allowed", code: "charge_changed" });
      expect(s.calls.cancelRoom).toBe(0);
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("CONFIRMED");
    });
  });

  describe("record refund (cancelled by the hotel)", () => {
    async function cancelledByHotel() {
      const r = await confirmed();
      await db.booking.update({ where: { id: r.bookingId }, data: { status: "CANCELLED_BY_SUPPLIER", needsAttention: true } });
      return r;
    }

    it("credits the amount once through the ledger, never above the charge; the agent is emailed", async () => {
      const { bookingId, total } = await cancelledByHotel();
      const balance = (await getBalance("A")).balanceCents;
      expect(await adminRecordSupplierRefund(ADMIN, bookingId, total + 1)).toMatchObject({ kind: "not_allowed" });
      expect(await adminRecordSupplierRefund(ADMIN, bookingId, 0)).toMatchObject({ kind: "not_allowed" });
      const part = total - 1234;
      // A double click, in parallel: one refund.
      const results = await Promise.all([adminRecordSupplierRefund(ADMIN, bookingId, part), adminRecordSupplierRefund(ADMIN, bookingId, part)]);
      expect(results.map((r) => r.kind).sort()).toEqual(["already", "recorded"]);
      expect((await getBalance("A")).balanceCents).toBe(balance + part);
      expect(await db.ledgerEntry.count({ where: { type: "REFUND", agencyId: "A" } })).toBe(1);
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ refundMinor: part, cancelChargeMinor: 1234, status: "CANCELLED_BY_SUPPLIER" });
      expect(await emails(bookingId)).toContain("refund_recorded");
      expect(await audits("booking.refund")).toHaveLength(1);
      expect(await db.bookingEvent.count({ where: { bookingId, reason: { startsWith: "Refund recorded by an admin" } } })).toBe(1);
    });

    it("only for a booking cancelled by the hotel", async () => {
      const { bookingId, total } = await confirmed();
      expect(await adminRecordSupplierRefund(ADMIN, bookingId, total)).toMatchObject({ kind: "not_allowed" });
      expect(await db.ledgerEntry.count({ where: { type: "REFUND" } })).toBe(0);
    });
  });

  describe("release the hold and mark failed", () => {
    it("releases the money, marks the booking not confirmed with the note, clears the flag, emails the agent; a second click changes nothing", async () => {
      const { bookingId } = await pending();
      const held = await getBalance("A");
      expect(held.heldCents).toBeGreaterThan(0);
      await expect(adminReleaseHold(ADMIN, bookingId, "")).rejects.toThrow(BookingInputInvalid);
      expect(await adminReleaseHold(ADMIN, bookingId, "Expedia has no itinerary for this reference")).toBe("released");
      expect(await adminReleaseHold(ADMIN, bookingId, "Expedia has no itinerary for this reference")).toBe("already");
      expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "FAILED", needsAttention: false });
      expect((await getBalance("A")).heldCents).toBe(0);
      expect(await db.ledgerEntry.count({ where: { type: "HOLD_RELEASE" } })).toBe(1);
      expect(await db.bookingEvent.findFirst({ where: { bookingId, toStatus: "FAILED" } })).toMatchObject({ actorUserId: ADMIN, reason: "An admin released the hold: Expedia has no itinerary for this reference" });
      expect(await emails(bookingId)).toContain("failed");
      expect(await audits("booking.release-hold")).toHaveLength(1);
    });

    it("a confirmed booking (the hold was captured) cannot be released", async () => {
      const { bookingId } = await confirmed();
      expect(await adminReleaseHold(ADMIN, bookingId, "Checked the supplier")).toBe("not_allowed");
      expect(await db.ledgerEntry.count({ where: { type: "HOLD_RELEASE", reason: "Hold released" } })).toBe(0);
    });
  });
});

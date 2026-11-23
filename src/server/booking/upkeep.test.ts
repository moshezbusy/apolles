import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { enqueue } from "@/server/jobs/queue";
import { SupplierUnavailable } from "@/server/supplier/expedia/client";
import type { BookingSupplier, RetrievedItinerary, SupplierAdapter, SupplierContext } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";
import { renderVoucher } from "./voucher";
import { checkConfirmedAtSupplier, expireOldDrafts, sweepWaitingBookings } from "./upkeep";

const NOW = new Date("2027-03-01T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const day = (n: number) => days(n).toISOString().slice(0, 10);

type Status = "DRAFT" | "PENDING_CONFIRMATION" | "CONFIRMED" | "CANCEL_PENDING" | "FAILED" | "CANCELLED";
type Extra = Partial<{ checkin: string; needsAttention: boolean; cancelRestoredAt: Date; cancelRestoredChargeMinor: number; supplierCheckedAt: Date; agentIp: string; agentUserAgent: string; rooms: number }>;

async function agency() {
  await db.agency.create({ data: { id: "A", name: "Sunrise Travel", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u-A", email: "agent@sunrise.example", name: "Ruth", role: "AGENT", agencyId: "A" } });
}

async function booking(id: string, status: Status, extra: Extra = {}) {
  const { rooms = 1, ...columns } = extra;
  const totalMinor = 20_000 * rooms;
  await db.booking.create({
    data: {
      id, reference: `APL-${id.toUpperCase().padEnd(8, "0")}`, agencyId: "A", userId: "u-A", status, propertyId: "1", hotelName: "Hotel Lumiere", hotelCity: "Paris", roomId: "r",
      roomName: "Superior King Room", rateId: "x", bedGroupId: "b", bedDescription: "1 King Bed", checkin: day(5), checkout: day(7), adults: rooms, childAges: [],
      leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972 501234567", guests: [{ givenName: "Dana", familyName: "Levi" }], refundable: true,
      totalMinor, chargedMinor: status === "DRAFT" ? null : totalMinor, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], priceCheckToken: "tok-a1",
      specialRequest: "High floor.", supplierItineraryId: status === "CONFIRMED" ? `IT-${id}` : null, ...columns,
    },
  });
  for (let index = 0; index < rooms; index++) {
    await db.bookingRoom.create({
      data: { bookingId: id, index, adults: 1, childAges: [], guests: [{ givenName: "Dana", familyName: "Levi" }], givenName: "Dana", familyName: "Levi", totalMinor: 20_000, price: {}, supplierRoomId: `s-${index + 1}`, cancelLink: `cancel-${id}-${index + 1}` },
    });
  }
}

const at = (id: string, date: Date) => db.$executeRaw`UPDATE "Booking" SET "updatedAt" = ${date} WHERE "id" = ${id}`;
const checks = async () => (await db.job.findMany({ where: { kind: "booking.reconcile" }, orderBy: { createdAt: "asc" } })).map((j) => [(j.payload as { bookingId: string }).bookingId, j.status, j.runAt]);
const flags = async (id: string) => (await db.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: "asc" } })).map((e) => e.reason);
const emails = async () => (await db.job.findMany({ where: { kind: "email.booking" } })).map((j) => j.payload as { bookingId: string; event: string }).map((p) => `${p.bookingId}:${p.event}`).sort();

// What the supplier shows for each booking (by our reference): rooms by status, or an error.
type Shown = RetrievedItinerary["rooms"][number]["status"][] | "down" | "none";
function supplier(shown: Record<string, Shown>, seen: SupplierContext[] = []): SupplierAdapter & BookingSupplier {
  const never = async (): Promise<never> => { throw new Error("not used in this test"); };
  return {
    searchAvailability: never,
    priceCheck: never,
    book: never,
    cancelRoom: never,
    retrieve: never,
    findByAffiliateReference: async (ref, context) => {
      seen.push(context);
      const rooms = shown[ref.affiliateReferenceId] ?? ["booked"];
      if (rooms === "down") throw new SupplierUnavailable("down", 503);
      if (rooms === "none") return null;
      return { itineraryId: "IT", rooms: rooms.map((status, i) => ({ id: `s-${i + 1}`, status, hotelConfirmationId: null, cancelLink: null, givenName: "Dana", familyName: "Levi" })) };
    },
  };
}
const ref = (id: string) => `APL-${id.toUpperCase().padEnd(8, "0")}`;

describe("sweepWaitingBookings", () => {
  beforeEach(async () => {
    await resetTestDb();
    await agency();
  });

  it("queues a check for every waiting booking that has none, and only for those", async () => {
    for (const [id, status] of [["p1", "PENDING_CONFIRMATION"], ["c1", "CANCEL_PENDING"], ["p2", "PENDING_CONFIRMATION"], ["ok", "CONFIRMED"], ["f1", "FAILED"], ["d1", "DRAFT"]] as const) {
      await booking(id, status);
      await at(id, minutes(-30));
    }
    // p2 already has a check queued.
    await enqueue("booking.reconcile", { bookingId: "p2" }, { runAt: minutes(3) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sweepWaitingBookings(NOW)).toBe(2);
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual(["booking sweep: 2 waiting bookings had no check queued; one was queued for each"]);
    log.mockRestore();
    expect((await checks()).sort()).toEqual([["c1", "QUEUED", NOW], ["p1", "QUEUED", NOW], ["p2", "QUEUED", minutes(3)]]);
    // Run again: everything has a check now.
    expect(await sweepWaitingBookings(NOW)).toBe(0);
    expect(await db.job.count()).toBe(3);
  });

  it("a check that is running counts; one that finished, failed for good or is far in the future does not", async () => {
    for (const id of ["run", "done", "dead", "far"]) {
      await booking(id, "PENDING_CONFIRMATION");
      await at(id, minutes(-30));
    }
    const jobs = {
      run: await enqueue("booking.reconcile", { bookingId: "run" }, { runAt: minutes(-1) }),
      done: await enqueue("booking.reconcile", { bookingId: "done" }, { runAt: minutes(-1) }),
      dead: await enqueue("booking.reconcile", { bookingId: "dead" }, { runAt: minutes(-1) }),
    };
    await db.job.update({ where: { id: jobs.run.id }, data: { status: "RUNNING", lockedAt: NOW } });
    await db.job.update({ where: { id: jobs.done.id }, data: { status: "DONE" } });
    await db.job.update({ where: { id: jobs.dead.id }, data: { status: "FAILED" } });
    await enqueue("booking.reconcile", { bookingId: "far" }, { runAt: days(1) }); // a late look, a day away
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sweepWaitingBookings(NOW)).toBe(3);
    vi.restoreAllMocks();
    const queuedNow = (await checks()).filter(([, status, runAt]) => status === "QUEUED" && (runAt as Date).getTime() === NOW.getTime()).map(([id]) => id);
    expect(queuedNow.sort()).toEqual(["dead", "done", "far"]);
  });

  it("a booking that changed in the last 2 minutes is left to its own job", async () => {
    await booking("new", "PENDING_CONFIRMATION");
    await at("new", minutes(-1));
    expect(await sweepWaitingBookings(NOW)).toBe(0);
    expect(await db.job.count()).toBe(0);
  });
});

describe("checkConfirmedAtSupplier", () => {
  beforeEach(async () => {
    await resetTestDb();
    await agency();
    await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 100_000, reason: "test", idempotencyKey: "seed" });
  });

  it("reads every confirmed booking checking in within 14 days, with the agent's IP and browser, and no others", async () => {
    await booking("soon", "CONFIRMED", { checkin: day(0), agentIp: "203.0.113.7", agentUserAgent: "Mozilla/5.0 (Agent)" });
    await booking("edge", "CONFIRMED", { checkin: day(14) });
    await booking("later", "CONFIRMED", { checkin: day(15) });
    await booking("past", "CONFIRMED", { checkin: day(-1) });
    await booking("pending", "PENDING_CONFIRMATION", { checkin: day(3) });
    const seen: SupplierContext[] = [];
    const result = await checkConfirmedAtSupplier("window", { supplier: supplier({}, seen), now: NOW });
    expect(result).toEqual({ checked: 2, cancelled: 0, flagged: 0, unread: 0 });
    expect(seen).toEqual([{}, { customerIp: "203.0.113.7", userAgent: "Mozilla/5.0 (Agent)" }]); // in id order: edge, soon
    const checked = await db.booking.findMany({ where: { supplierCheckedAt: { not: null } }, select: { id: true }, orderBy: { id: "asc" } });
    expect(checked.map((b) => b.id)).toEqual(["edge", "soon"]);
    expect(await db.booking.count({ where: { needsAttention: true } })).toBe(0);
  });

  it("the run on the day before check-in reads only bookings about to check in", async () => {
    await booking("today", "CONFIRMED", { checkin: day(0) });
    await booking("tomorrow", "CONFIRMED", { checkin: day(1) });
    await booking("week", "CONFIRMED", { checkin: day(7) });
    expect(await checkConfirmedAtSupplier("eve", { supplier: supplier({}), now: NOW })).toMatchObject({ checked: 2 });
    expect((await db.booking.findUniqueOrThrow({ where: { id: "week" } })).supplierCheckedAt).toBeNull();
  });

  it("cancelled at the supplier: CANCELLED_BY_SUPPLIER, agent and admin emails, an admin flag, and no refund", async () => {
    await booking("gone", "CONFIRMED");
    await booking("fine", "CONFIRMED");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkConfirmedAtSupplier("window", { supplier: supplier({ [ref("gone")]: ["cancelled"] }), now: NOW });
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([`booking ${ref("gone")}: cancelled at the supplier, not by the agent; marked cancelled by the hotel, no refund made, needs an admin`]);
    log.mockRestore();
    expect(result).toEqual({ checked: 2, cancelled: 1, flagged: 0, unread: 0 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: "gone" } })).toMatchObject({ status: "CANCELLED_BY_SUPPLIER", needsAttention: true, refundMinor: null, cancelledAt: NOW });
    expect((await db.bookingRoom.findMany({ where: { bookingId: "gone" } })).map((r) => r.status)).toEqual(["CANCELLED"]);
    expect(await db.booking.findUniqueOrThrow({ where: { id: "fine" } })).toMatchObject({ status: "CONFIRMED", needsAttention: false });
    expect(await flags("gone")).toEqual([
      "The supplier shows the booking cancelled: cancelled by the hotel or the supplier, not by the agent. No refund was made",
      "Cancelled by the hotel or the supplier: check the refund with the supplier and record it on the wallet by hand",
    ]);
    expect(await emails()).toEqual(["gone:cancelled_by_supplier", "gone:cancelled_by_supplier_admin", "gone:needs_attention"]);
    // No automatic refund: the wallet is untouched.
    expect(await db.ledgerEntry.count({ where: { type: "REFUND" } })).toBe(0);
    expect(await getBalance("A")).toEqual({ balanceCents: 100_000, heldCents: 0 });
    // The voucher of a booking the hotel cancelled is no longer downloadable.
    await expect(renderVoucher("A", "gone")).rejects.toThrow();
    // The next run leaves it alone.
    expect(await checkConfirmedAtSupplier("eve", { supplier: supplier({ [ref("gone")]: ["cancelled"] }), now: days(0.5) })).toMatchObject({ cancelled: 0 });
    expect(await emails()).toHaveLength(3);
  });

  it("only some rooms cancelled there, or the booking not found there: an admin is told, the booking stays confirmed", async () => {
    await booking("part", "CONFIRMED", { rooms: 2 });
    await booking("lost", "CONFIRMED");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkConfirmedAtSupplier("window", { supplier: supplier({ [ref("part")]: ["booked", "cancelled"], [ref("lost")]: "none" }), now: NOW });
    vi.restoreAllMocks();
    expect(result).toEqual({ checked: 2, cancelled: 0, flagged: 2, unread: 0 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: "part" } })).toMatchObject({ status: "CONFIRMED", needsAttention: true });
    expect(await flags("part")).toEqual(["Room 2 of 2 is cancelled at the supplier while the booking is confirmed: an admin settles it"]);
    expect(await db.booking.findUniqueOrThrow({ where: { id: "lost" } })).toMatchObject({ status: "CONFIRMED", needsAttention: true });
    expect(await flags("lost")).toEqual(["The supplier does not find this confirmed booking: an admin checks it"]);
    expect(await db.ledgerEntry.count({ where: { type: "REFUND" } })).toBe(0);
  });

  it("a booking that cannot be read does not stop the others; a supplier that is not answering stops the run with an error", async () => {
    for (const id of ["a", "b", "c"]) await booking(id, "CONFIRMED");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await checkConfirmedAtSupplier("window", { supplier: supplier({ [ref("a")]: "down", [ref("c")]: ["cancelled"] }), now: NOW })).toEqual({ checked: 2, cancelled: 1, flagged: 0, unread: 1 });
    expect((await db.booking.findUniqueOrThrow({ where: { id: "a" } })).supplierCheckedAt).toBeNull();
    // Everything down: stopped after 5 in a row (the job fails and is tried again), nothing changed.
    await resetTestDb();
    await agency();
    const all: Record<string, Shown> = {};
    for (let i = 0; i < 8; i++) {
      await booking(`x${i}`, "CONFIRMED");
      all[ref(`x${i}`)] = "down";
    }
    await expect(checkConfirmedAtSupplier("window", { supplier: supplier(all), now: NOW })).rejects.toThrow("The supplier is not answering: the check of confirmed bookings stopped after 5 failures in a row");
    vi.restoreAllMocks();
    expect(await db.booking.count({ where: { status: "CONFIRMED", needsAttention: false } })).toBe(8);
  });

  it("a booking read in the last 3 hours is not read again (a retried run goes on where it stopped)", async () => {
    await booking("done", "CONFIRMED", { supplierCheckedAt: minutes(-60) });
    await booking("todo", "CONFIRMED");
    const seen: SupplierContext[] = [];
    expect(await checkConfirmedAtSupplier("window", { supplier: supplier({}, seen), now: NOW })).toMatchObject({ checked: 1 });
    expect(seen).toHaveLength(1);
  });

  it("a cancellation put back less than a day ago that went through late is finished as the agent's own cancellation, with its refund", async () => {
    await booking("late", "CONFIRMED", { cancelRestoredAt: minutes(-120), cancelRestoredChargeMinor: 5_000, needsAttention: true });
    const result = await checkConfirmedAtSupplier("window", { supplier: supplier({ [ref("late")]: ["cancelled"] }), now: NOW });
    expect(result).toMatchObject({ checked: 1, cancelled: 0 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: "late" } })).toMatchObject({ status: "CANCELLED", cancelChargeMinor: 5_000, refundMinor: 15_000 });
    expect((await db.ledgerEntry.findMany({ where: { type: "REFUND" } })).map((e) => e.amountCents)).toEqual([15_000]);
    expect(await emails()).toContain("late:cancelled");
  });
});

describe("expireOldDrafts", () => {
  beforeEach(async () => {
    await resetTestDb();
    await agency();
  });

  it("a draft untouched for 7 days is EXPIRED and its personal details are blanked; newer drafts and real bookings are left alone", async () => {
    await booking("old", "DRAFT", { agentIp: "203.0.113.7", agentUserAgent: "Mozilla/5.0 (Agent)" });
    await booking("new", "DRAFT");
    await booking("real", "CONFIRMED");
    await at("old", days(-8));
    await at("new", days(-6));
    await at("real", days(-30));
    expect(await expireOldDrafts(NOW)).toBe(1);
    const old = await db.booking.findUniqueOrThrow({ where: { id: "old" }, include: { rooms: true, events: true } });
    expect(old).toMatchObject({
      status: "EXPIRED", leadGivenName: "", leadFamilyName: "", leadEmail: "", leadPhone: "", guests: [], specialRequest: "", agentIp: null, agentUserAgent: null, bookToken: null, priceCheckToken: "",
      hotelName: "Hotel Lumiere", totalMinor: 20_000,
    });
    expect(old.rooms.map((r) => [r.givenName, r.familyName, r.guests])).toEqual([["", "", []]]);
    expect(old.events.map((e) => [e.fromStatus, e.toStatus, e.actorUserId, e.reason])).toEqual([["DRAFT", "EXPIRED", null, "Draft not booked within 7 days: expired, personal details removed"]]);
    expect(await db.booking.findUniqueOrThrow({ where: { id: "new" } })).toMatchObject({ status: "DRAFT", leadGivenName: "Dana", leadEmail: "dana@example.com" });
    expect(await db.booking.findUniqueOrThrow({ where: { id: "real" } })).toMatchObject({ status: "CONFIRMED", leadGivenName: "Dana" });
    expect(await expireOldDrafts(NOW)).toBe(0);
  });
});

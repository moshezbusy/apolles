import { beforeEach, describe, expect, it, vi } from "vitest";
import { book, cancel, cancelQuote, createDraft, prepareReview, reconcile } from "@/server/booking/service";
import { bookingSale } from "@/server/booking/selling";
import { createClient, addCompanion } from "@/server/clients";
import { db } from "@/server/db";
import { addFromSearch, closeQuote, removeRoom, removeStay, setClientCancelDate, setRoomPrice, updateQuoteSettings } from "@/server/quotes/quotes";
import { clientQuote, shareLink, submitSelection } from "@/server/quotes/sharing";
import { bookingPrefill, matchRate, otherRooms, prepareQuoteBooking, quoteReview, stayBookings } from "@/server/quotes/quote-booking";
import { startSearch } from "@/server/search/search";
import { SupplierOutcomeUnknown } from "@/server/supplier/expedia/client";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import type { BookingSupplier, Offer, SupplierAdapter } from "@/server/supplier/types";
import { credit } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn(async () => {}) }));

const NOW = new Date("2027-03-01T10:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const ctx = (agencyId = "A", userId = "u-A") => ({ agencyId, userId, supplierContext: {} });

type Supplier = SupplierAdapter & BookingSupplier;
function supplier(overrides: Partial<Supplier> = {}): Supplier {
  const real = new FakeSupplierAdapter();
  return {
    searchAvailability: (q) => (overrides.searchAvailability ? overrides.searchAvailability(q, {}) : real.searchAvailability(q)),
    priceCheck: async (r) => real.priceCheck(r),
    book: async (i, c) => (overrides.book ? overrides.book(i, c) : real.book(i)),
    findByAffiliateReference: async (r, c) => (overrides.findByAffiliateReference ? overrides.findByAffiliateReference(r, c) : real.findByAffiliateReference(r)),
    retrieve: async (l) => real.retrieve(l),
    cancelRoom: async (l) => real.cancelRoom(l),
  };
}

const guests = [
  { givenName: "Daniel", familyName: "Levy" },
  { givenName: "Maya", familyName: "Levy" },
];

let quoteId: string;
let clientId: string;

async function quoteStays(): Promise<{ id: string; rooms: { id: string; rateId: string; bedGroupId: string }[] }[]> {
  const stays = await db.quoteStay.findMany({
    where: { quoteId },
    orderBy: { position: "asc" },
    select: { id: true, hotels: { select: { rooms: { select: { id: true, rateId: true, bedGroupId: true } } } } },
  });
  return stays.map((s) => ({ id: s.id, rooms: s.hotels.flatMap((h) => h.rooms) }));
}

async function pick(stayId: string, roomId: string): Promise<void> {
  await db.quoteStay.update({ where: { id: stayId }, data: { selectedRoomId: roomId } });
  await db.quote.update({ where: { id: quoteId }, data: { status: "SELECTED", selectedAt: NOW } });
}

async function addStay(checkin: string, checkout: string): Promise<void> {
  const { snapshotId } = await startSearch(ctx(), { destinationId: "paris", checkin, checkout, rooms: [{ adults: 2, childAges: [] }] }, { adapter: supplier(), now: NOW });
  const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
  const offer = (hotel.offers as unknown as Offer[])[0]!;
  const added = await addFromSearch("u-A", "A", { quoteId: quoteId || "new", snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id }, NOW);
  if (!added.ok) throw new Error(added.error);
  quoteId = added.id;
}

beforeEach(async () => {
  await resetTestDb();
  quoteId = "";
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 2_000_000, reason: "test", idempotencyKey: "seed-topup" });
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
  await addStay("2027-04-10", "2027-04-12");
  const client = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "daniel@example.com", nationality: "IL", notes: "" });
  if (!client.ok) throw new Error("setup");
  clientId = client.id;
  await addCompanion("u-A", "A", clientId, { firstName: "Maya", lastName: "Levy", relation: "Spouse", childAge: "" });
  await updateQuoteSettings("u-A", "A", quoteId, {
    title: "Paris", clientId, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "",
  });
});

async function bookStay(stayId: string, deps: { supplier?: Supplier } = {}) {
  const prepared = await prepareQuoteBooking(ctx(), stayId, { adapter: supplier(), now: NOW });
  if (!prepared.ok) throw new Error(prepared.error);
  const { s, p, r, b } = prepared.rate;
  const { bookingId } = await createDraft(
    ctx(),
    { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stayId, rooms: [{ guests }], leadEmail: "daniel@example.com", leadPhone: { countryCode: "972", number: "501234567" } },
    { now: later(1) },
  );
  const review = await prepareReview(ctx(), bookingId, { supplier: deps.supplier ?? supplier(), now: later(2) });
  if (review.kind !== "ready") throw new Error("not ready");
  const outcome = await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: review.booking.totalMinor }, { supplier: deps.supplier ?? supplier(), now: later(3) });
  return { bookingId, outcome };
}

describe("book the client's selection from a quote", () => {
  it("searches the quoted hotel again and finds the same rate; nothing for another agency or without a pick", async () => {
    const [stay] = await quoteStays();
    const room = stay!.rooms[0]!;
    expect(await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW })).toEqual({ ok: false, error: "The client has not chosen a room here yet." });
    await pick(stay!.id, room.id);
    expect((await prepareQuoteBooking(ctx("B", "u-B"), stay!.id, { adapter: supplier(), now: NOW })).ok).toBe(false);
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    expect(prepared).toMatchObject({ ok: true, rate: { p: "11", r: room.rateId, b: room.bedGroupId } });
    const snapshot = await db.searchSnapshot.findUniqueOrThrow({ where: { id: prepared.ok ? prepared.rate.s : "" } });
    expect(snapshot).toMatchObject({ agencyId: "A", candidateIds: ["11"], query: expect.objectContaining({ checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] }) });
  });

  it("the hotel has no rooms left for the dates: says so, and the quote stays as it is", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const empty = supplier({ searchAvailability: async () => [] });
    expect(await prepareQuoteBooking(ctx(), stay!.id, { adapter: empty, now: NOW })).toEqual({
      ok: false,
      error: "This room is no longer available at this hotel for these dates. This hotel has no rooms left for them. Ask the client to choose another hotel, or close the quote.",
    });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay!.id } })).toMatchObject({ selectedRoomId: stay!.rooms[0]!.id });
  });

  it("the picked rate is gone but the hotel has other rooms: the agent is sent to them, the destination is kept, and one of them can be booked", async () => {
    const [stay] = await quoteStays();
    const roomId = stay!.rooms[0]!.id;
    // The quoted room is one the supplier no longer has in any form.
    await db.quoteRoom.update({ where: { id: roomId }, data: { roomId: "gone-room", rateId: "gone-rate", bedGroupId: "gone-bed" } });
    await pick(stay!.id, roomId);
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    expect(prepared).toMatchObject({ ok: false, error: expect.stringContaining("Choose another room of this hotel"), rooms: { quoteId, snapshotId: expect.any(String) } });
    const snapshotId = !prepared.ok && prepared.rooms ? prepared.rooms.snapshotId : "";
    // The stay and the client's pick are still there (before: the quote was stuck with no way on).
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay!.id } })).toMatchObject({ selectedRoomId: roomId });
    const rooms = await otherRooms("A", quoteId, stay!.id, snapshotId, NOW);
    expect(rooms).toMatchObject({ quoteId, stayId: stay!.id, propertyId: "11", hotelName: "Hotel 11" });
    expect(rooms?.offers.length).toBeGreaterThan(0);
    // Another agency, or another agency's search, sees nothing.
    expect(await otherRooms("B", quoteId, stay!.id, snapshotId, NOW)).toBeNull();
    expect(await otherRooms("A", quoteId, stay!.id, "not-a-search", NOW)).toBeNull();
    // Any rate of the picked hotel books for this destination, linked to the quote.
    const offer = rooms!.offers[0]!;
    const { bookingId } = await createDraft(
      ctx(),
      { snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "daniel@example.com", leadPhone: { countryCode: "972", number: "501234567" } },
      { now: later(1) },
    );
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking).toMatchObject({ quoteId, quoteStayId: stay!.id });
    // The review page tells the agent this is not the rate that was quoted, and asks for the tick.
    expect(await quoteReview("A", booking, later(2))).toMatchObject({ rateChanged: true, needsCheck: true });
  });

  it("booking the only destination marks the quote booked; the stay shows the booking", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const { bookingId, outcome } = await bookStay(stay!.id);
    expect(outcome.kind).toBe("confirmed");
    // The price quoted to the client (net + 10%) goes with the booking as an amount (reports only).
    const booked = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const quoted = booked.totalMinor + Math.floor((booked.totalMinor * 1000 + 5_000) / 10_000);
    expect(booked).toMatchObject({ quoteId, quoteStayId: stay!.id, status: "CONFIRMED", sellMinor: quoted, sellMarkupType: "FIXED", sellMarkupValue: quoted - booked.totalMinor });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
    expect((await stayBookings("A", quoteId)).get(stay!.id)).toMatchObject({ id: bookingId, status: "CONFIRMED" });
    expect((await stayBookings("B", quoteId)).size).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { action: "quote.booked", targetId: quoteId } });
    expect(audit).not.toBeNull();
  });

  it("a quote with no markup and no typed price gives a booking with no selling price", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { markupValue: 0 } });
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const { bookingId } = await bookStay(stay!.id);
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ sellMinor: null, sellMarkupType: null, sellMarkupValue: null });
  });

  it("the net rose since the quote: the booking keeps the client's price, and the report shows the real profit", async () => {
    const [stay] = await quoteStays();
    const room = await db.quoteRoom.findUniqueOrThrow({ where: { id: stay!.rooms[0]!.id } });
    // When it was quoted the net was 60.00 lower, and the agent typed a price 100.00 above it.
    const oldNet = room.netMinor - 6_000;
    await db.quoteRoom.update({ where: { id: room.id }, data: { netMinor: oldNet, sellMinor: oldNet + 10_000 } });
    await pick(stay!.id, room.id);
    const { bookingId } = await bookStay(stay!.id);
    const booked = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booked).toMatchObject({ chargedMinor: room.netMinor, sellMinor: oldNet + 10_000, sellMarkupType: "FIXED", sellMarkupValue: 4_000 });
    // Before: sale = charge + 100.00 and profit 100.00. Now: the client's price, and 40.00.
    expect(bookingSale(booked)).toEqual({ netMinor: room.netMinor, saleMinor: oldNet + 10_000, profitMinor: 4_000, priced: true });
  });

  it("two destinations: the quote is booked only when both are", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    await bookStay(first!.id);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED" });
    await bookStay(second!.id);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
  });

  it("a destination is never booked twice from the quote; a destination the client skipped does not count", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    await bookStay(first!.id);
    expect(await prepareQuoteBooking(ctx(), first!.id, { adapter: supplier(), now: NOW })).toEqual({ ok: false, error: "This destination is already booked." });
    expect((await prepareQuoteBooking(ctx(), second!.id, { adapter: supplier(), now: NOW })).ok).toBe(true);
  });

  it("three destinations, the client picks one and it is booked: the quote stays open, the client can still choose the others, the agent can still edit", async () => {
    await addStay("2027-04-12", "2027-04-15");
    await addStay("2027-04-15", "2027-04-18");
    const [first, second, third] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    await bookStay(first!.id);
    // Before: the whole quote turned Booked and locked here.
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED" });
    const shared = await shareLink("u-A", "A", quoteId, "link", { now: NOW });
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    const view = (await clientQuote(token, NOW))?.view;
    expect(view).toMatchObject({ state: "open", stays: [{ booked: true, confirmed: true }, { booked: false, confirmed: false }, { booked: false }] });
    // The client picks the second destination (the booked one keeps its pick).
    const price = view?.stays[1]?.hotels[0]?.rooms[0]?.sellMinor ?? 0;
    const picks = { [first!.id]: first!.rooms[0]!.id, [second!.id]: second!.rooms[0]!.id };
    expect(await submitSelection(token, { picks, seen: { [second!.rooms[0]!.id]: price }, note: "" }, "203.0.113.9", NOW)).toEqual({ ok: true });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: second!.id } })).toMatchObject({ selectedRoomId: second!.rooms[0]!.id });
    // The agent edits a destination that is not booked.
    expect((await setRoomPrice("u-A", "A", third!.rooms[0]!.id, "5000")).ok).toBe(true);
    expect((await removeStay("u-A", "A", third!.id)).ok).toBe(true);
    // Booked only once every destination that still has rooms is booked.
    await bookStay(second!.id);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
  });

  it("a partly booked quote is finished on purpose with 'Close quote': read-only for the client, the booking untouched", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    const { bookingId } = await bookStay(first!.id);
    const shared = await shareLink("u-A", "A", quoteId, "link", { now: NOW });
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    expect(await closeQuote("u-A", "A", quoteId)).toEqual({ ok: true, id: quoteId });
    expect((await clientQuote(token, NOW))?.view.state).toBe("closed");
    expect(await submitSelection(token, { picks: { [first!.id]: first!.rooms[0]!.id }, note: "" }, "203.0.113.9", NOW)).toEqual({ ok: false, error: "closed" });
    expect(await prepareQuoteBooking(ctx(), second!.id, { adapter: supplier(), now: NOW })).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED" });
  });

  it("a destination whose rooms were all removed does not keep the quote open", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await removeRoom("u-A", "A", second!.rooms[0]!.id);
    await pick(first!.id, first!.rooms[0]!.id);
    await bookStay(first!.id);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
  });

  it("the second of two drafts of one destination cannot book", async () => {
    await addStay("2027-04-12", "2027-04-15"); // a second picked destination keeps the quote open
    const [stay, second] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    if (!prepared.ok) throw new Error(prepared.error);
    const { s, p, r, b } = prepared.rate;
    const input = { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "daniel@example.com", leadPhone: { countryCode: "972", number: "501234567" } };
    const one = await createDraft(ctx(), input, { now: later(1) });
    const two = await createDraft(ctx(), input, { now: later(1) });
    for (const id of [one.bookingId, two.bookingId]) {
      const review = await prepareReview(ctx(), id, { supplier: supplier(), now: later(2) });
      if (review.kind !== "ready") throw new Error("not ready");
    }
    const total = (await db.booking.findUniqueOrThrow({ where: { id: one.bookingId } })).totalMinor;
    expect((await book(ctx(), one.bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(3) })).kind).toBe("confirmed");
    expect(await book(ctx(), two.bookingId, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(3) })).toEqual({
      kind: "review_again",
      message: "This destination of the quote is already booked. Open the quote to see the booking.",
    });
    expect(await db.booking.findUniqueOrThrow({ where: { id: two.bookingId } })).toMatchObject({ status: "DRAFT" });
  });

  it("a draft from a quote must be the stay's own hotel and dates, of the agency's own quote", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const other = await startSearch(ctx(), { destinationId: "paris", checkin: "2027-05-01", checkout: "2027-05-03", rooms: [{ adults: 2, childAges: [] }] }, { adapter: supplier(), now: NOW });
    const offer = ((await db.searchHotel.findFirstOrThrow({ where: { snapshotId: other.snapshotId } })).offers as unknown as Offer[])[0]!;
    const input = { snapshotId: other.snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "d@example.com", leadPhone: { countryCode: "972", number: "501234567" } };
    await expect(createDraft(ctx(), input, { now: later(1) })).rejects.toThrow(/not the dates or hotel of this quote/);
    await db.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    expect(prepared).toEqual({ ok: false, error: "This quote is already booked." });
  });

  it("a booking confirmed later by the check job also marks the quote booked", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const unknown = supplier({
      book: async () => {
        throw new SupplierOutcomeUnknown("timeout");
      },
    });
    const { bookingId, outcome } = await bookStay(stay!.id, { supplier: unknown });
    expect(outcome.kind).toBe("pending");
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED" });
    expect(await reconcile(bookingId, { supplier: supplier(), now: later(8) })).toBe("confirmed");
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
  });
});

describe("a booked destination (review fixes)", () => {
  it("cancelling the booking reopens the quote, and the destination can be booked again", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const { bookingId } = await bookStay(stay!.id);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
    const booking = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const charge = cancelQuote(booking, await db.bookingRoom.findMany({ where: { bookingId } }), later(10));
    if (!charge.allowed) throw new Error(charge.reason);
    expect(await cancel(ctx(), bookingId, { expectedChargeMinor: charge.chargeMinor }, { supplier: supplier(), now: later(10) })).toEqual({ kind: "cancelled" });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED" });
    expect(await db.auditLog.count({ where: { action: "quote.reopened", targetId: quoteId } })).toBe(1);
    const again = await bookStay(stay!.id);
    expect(again.outcome.kind).toBe("confirmed");
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
  });

  it("while booked, the client cannot change that pick and the agent cannot remove its rooms", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    await bookStay(first!.id);
    const shared = await shareLink("u-A", "A", quoteId, "link");
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    expect(await submitSelection(token, { picks: { [second!.id]: second!.rooms[0]!.id }, note: "" }, "203.0.113.9")).toEqual({ ok: false, error: "locked" });
    expect(await removeRoom("u-A", "A", first!.rooms[0]!.id)).toEqual({ ok: false, error: "This destination has a booking. Cancel the booking first to change it." });
    expect((await removeStay("u-A", "A", first!.id)).ok).toBe(false);
    // A booked destination is frozen for the agent too: no new price, no new client date, no new rooms.
    expect(await setRoomPrice("u-A", "A", first!.rooms[0]!.id, "9000")).toEqual({ ok: false, error: "This destination has a booking. Cancel the booking first to change it." });
    expect(await setClientCancelDate("u-A", "A", first!.rooms[0]!.id, "2027-03-20", NOW)).toEqual({ ok: false, error: "This destination has a booking. Cancel the booking first to change it." });
    const again = await startSearch(ctx(), { destinationId: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] }, { adapter: supplier(), now: NOW });
    const offers = (await db.searchHotel.findFirstOrThrow({ where: { snapshotId: again.snapshotId } })).offers as unknown as Offer[];
    const extra = offers.find((o) => o.rateId !== first!.rooms[0]!.rateId) ?? offers[0]!;
    expect(await addFromSearch("u-A", "A", { quoteId, snapshotId: again.snapshotId, propertyId: "11", rateId: extra.rateId, bedGroupId: extra.bedGroups[0]!.id }, NOW)).toEqual({
      ok: false,
      error: "This destination has a booking. Cancel the booking first to change it.",
    });
    // The other destination still changes; un-picking it keeps the quote open (it still has rooms to choose).
    expect(await submitSelection(token, { picks: { [first!.id]: first!.rooms[0]!.id }, note: "" }, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED" });
  });

  it("the client changes the pick after the draft: 'Book' is refused and nothing is charged", async () => {
    await db.property.create({ data: { id: "12", name: "Hotel 12", city: "Paris", countryCode: "FR", rank: 2, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    if (!prepared.ok) throw new Error(prepared.error);
    const { s, p, r, b } = prepared.rate;
    const { bookingId } = await createDraft(ctx(), { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "d@example.com", leadPhone: { countryCode: "972", number: "501234567" } }, { now: later(1) });
    const review = await prepareReview(ctx(), bookingId, { supplier: supplier(), now: later(2) });
    if (review.kind !== "ready") throw new Error("not ready");
    // The client now picks a room of another hotel on this destination.
    const otherHotel = await db.quoteHotel.create({ data: { stayId: stay!.id, propertyId: "12", name: "Hotel 12", city: "Paris", position: 1 } });
    const otherRoom = await db.quoteRoom.create({
      data: { hotelId: otherHotel.id, roomId: "x", rateId: "x", bedGroupId: "x", roomName: "Room", bedDescription: "Bed", refundable: true, netMinor: 1000, currency: "USD", price: {}, position: 0 },
    });
    await db.quoteStay.update({ where: { id: stay!.id }, data: { selectedRoomId: otherRoom.id } });
    expect(await book(ctx(), bookingId, { acceptedTerms: true, expectedTotalMinor: review.booking.totalMinor }, { supplier: supplier(), now: later(3) })).toEqual({
      kind: "review_again",
      message: "The client's choice on this quote changed. Open the quote and choose Book again.",
    });
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ status: "DRAFT", holdId: null });
  });

  it("the client of a quote with a booking cannot change", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first, second] = await quoteStays();
    await pick(first!.id, first!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    await bookStay(first!.id);
    const other = await createClient("u-A", "A", { firstName: "Noa", lastName: "Bar", phone: "+972 50 765 4321", email: "", nationality: "IL", notes: "" });
    if (!other.ok) throw new Error("setup");
    expect(
      await updateQuoteSettings("u-A", "A", quoteId, { title: "Paris", clientId: other.id, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" }),
    ).toEqual({ ok: false, error: "This quote has a booking. Cancel the booking first to change the client." });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: first!.id } })).toMatchObject({ selectedRoomId: first!.rooms[0]!.id });
  });

  it("a draft from a quote must be the hotel the client picked", async () => {
    const [stay] = await quoteStays();
    const prepared = await (async () => {
      await pick(stay!.id, stay!.rooms[0]!.id);
      return prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    })();
    if (!prepared.ok) throw new Error(prepared.error);
    await db.quoteStay.update({ where: { id: stay!.id }, data: { selectedRoomId: null } });
    const { s, p, r, b } = prepared.rate;
    await expect(
      createDraft(ctx(), { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "d@example.com", leadPhone: { countryCode: "972", number: "501234567" } }, { now: later(1) }),
    ).rejects.toThrow(/not the dates or hotel of this quote/);
  });

  it("two 'Book' clicks at the same moment book the destination once", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [stay, second] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    await pick(second!.id, second!.rooms[0]!.id);
    const prepared = await prepareQuoteBooking(ctx(), stay!.id, { adapter: supplier(), now: NOW });
    if (!prepared.ok) throw new Error(prepared.error);
    const { s, p, r, b } = prepared.rate;
    const input = { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stay!.id, rooms: [{ guests }], leadEmail: "daniel@example.com", leadPhone: { countryCode: "972", number: "501234567" } };
    const ids = [(await createDraft(ctx(), input, { now: later(1) })).bookingId, (await createDraft(ctx(), input, { now: later(1) })).bookingId];
    for (const id of ids) await prepareReview(ctx(), id, { supplier: supplier(), now: later(2) });
    const total = (await db.booking.findUniqueOrThrow({ where: { id: ids[0]! } })).totalMinor;
    const outcomes = await Promise.all(ids.map((id) => book(ctx(), id, { acceptedTerms: true, expectedTotalMinor: total }, { supplier: supplier(), now: later(3) })));
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["confirmed", "review_again"]);
    expect(await db.booking.count({ where: { quoteStayId: stay!.id, status: "CONFIRMED" } })).toBe(1);
  });
});

describe("guest details from the quote", () => {
  it("the quote's client is the lead guest, the companions are the other guests; another agency gets nothing", async () => {
    const [stay] = await quoteStays();
    expect(await bookingPrefill("A", { stayId: stay!.id })).toEqual({
      clientId,
      guests: [
        { givenName: "Daniel", familyName: "Levy" },
        { givenName: "Maya", familyName: "Levy" },
      ],
      leadEmail: "daniel@example.com",
      phoneCountry: "972",
      phoneNumber: "501234567",
    });
    expect(await bookingPrefill("B", { stayId: stay!.id })).toBeNull();
    expect(await bookingPrefill("A", { clientId })).toMatchObject({ clientId, guests: [{ givenName: "Daniel" }, { givenName: "Maya" }] });
    expect(await bookingPrefill("B", { clientId })).toBeNull();
  });
});

describe("the review page of a booking from a quote: what the client was quoted against the rate now", () => {
  async function draftFor(stayId: string, deps: { supplier?: Supplier } = {}) {
    const prepared = await prepareQuoteBooking(ctx(), stayId, { adapter: supplier(), now: NOW });
    if (!prepared.ok) throw new Error(prepared.error);
    const { s, p, r, b } = prepared.rate;
    const { bookingId } = await createDraft(
      ctx(),
      { snapshotId: s, propertyId: p, rateId: r, bedGroupId: b, quoteStayId: stayId, rooms: [{ guests }], leadEmail: "daniel@example.com", leadPhone: { countryCode: "972", number: "501234567" } },
      { now: later(1) },
    );
    const review = await prepareReview(ctx(), bookingId, { supplier: deps.supplier ?? supplier(), now: later(2) });
    if (review.kind !== "ready") throw new Error("not ready");
    return review.booking;
  }

  it("nothing changed since the quote: the box shows the numbers and no tick is needed", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const booking = await draftFor(stay!.id);
    const quoted = booking.totalMinor + Math.floor((booking.totalMinor * 1000 + 5_000) / 10_000);
    expect(await quoteReview("A", booking, later(2))).toMatchObject({
      quoteId,
      number: 1,
      quotedMinor: quoted,
      priced: true,
      chosenAtMinor: null,
      netThenMinor: booking.totalMinor,
      netNowMinor: booking.totalMinor,
      profitNowMinor: quoted - booking.totalMinor,
      rateChanged: false,
      profitLower: false,
      termsWorse: false,
      needsCheck: false,
    });
    // Another agency, or a booking that is not from a quote, has no box.
    expect(await quoteReview("B", booking, later(2))).toBeNull();
    expect(await quoteReview("A", { ...booking, quoteStayId: null }, later(2))).toBeNull();
  });

  it("the client chose at 1,000 on a net of 900; the net is 960 now: the profit is 40, not 100, and booking needs the tick", async () => {
    const [stay] = await quoteStays();
    const room = await db.quoteRoom.findUniqueOrThrow({ where: { id: stay!.rooms[0]!.id } });
    // The quote was made when the net was 60.00 lower; the agent typed 100.00 above that net.
    const oldNet = room.netMinor - 6_000;
    await db.quoteRoom.update({ where: { id: room.id }, data: { netMinor: oldNet, sellMinor: oldNet + 10_000 } });
    await pick(stay!.id, room.id);
    await db.quoteStay.update({ where: { id: stay!.id }, data: { selectedSellMinor: oldNet + 10_000, selectedCurrency: "USD" } });
    const booking = await draftFor(stay!.id);
    expect(await quoteReview("A", booking, later(2))).toMatchObject({
      quotedMinor: oldNet + 10_000,
      netThenMinor: oldNet,
      netNowMinor: room.netMinor,
      profitThenMinor: 10_000,
      profitNowMinor: 4_000,
      profitLower: true,
      needsCheck: true,
    });
    // The net rose above the client's price: a loss, shown as a negative profit.
    await db.quoteRoom.update({ where: { id: room.id }, data: { sellMinor: room.netMinor - 2_000 } });
    expect(await quoteReview("A", booking, later(2))).toMatchObject({ profitNowMinor: -2_000, profitLower: true, needsCheck: true });
  });

  it("free cancellation the client saw is gone or earlier now: booking needs the tick", async () => {
    const [stay] = await quoteStays();
    const room = await db.quoteRoom.findUniqueOrThrow({ where: { id: stay!.rooms[0]!.id } });
    await pick(stay!.id, room.id);
    const draft = await draftFor(stay!.id);
    const now = later(2);
    // The rate being booked: free cancellation until Apr 4 (the first charge starts Apr 5, hotel time).
    const booking = { ...draft, refundable: true, cancelPenalties: [{ start: "2027-04-05T00:00:00.000+02:00", end: "2027-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }] };
    // Quoted with the same day: nothing is worse.
    await db.quoteRoom.update({ where: { id: room.id }, data: { refundable: true, freeCancelUntil: "2027-04-04", clientCancelUntil: "2027-04-03" } });
    expect(await quoteReview("A", booking, now)).toMatchObject({ freeThenDay: "2027-04-04", clientFreeDay: "2027-04-03", freeNowDay: "2027-04-04", termsWorse: false, needsCheck: false });
    // Quoted with a later day than the rate has now: earlier is worse.
    await db.quoteRoom.update({ where: { id: room.id }, data: { freeCancelUntil: "2027-04-07", clientCancelUntil: "2027-04-06" } });
    expect(await quoteReview("A", booking, now)).toMatchObject({ freeThenDay: "2027-04-07", clientFreeDay: "2027-04-06", freeNowDay: "2027-04-04", termsWorse: true, needsCheck: true });
    // The rate lost free cancellation altogether.
    expect(await quoteReview("A", { ...booking, refundable: false }, now)).toMatchObject({ freeNowDay: null, termsWorse: true, needsCheck: true });
    // Ten days later the day the client was shown has passed: free cancellation is gone, even on the same rate.
    await db.quoteRoom.update({ where: { id: room.id }, data: { freeCancelUntil: "2027-04-04", clientCancelUntil: "2027-04-03" } });
    expect(await quoteReview("A", booking, new Date("2027-04-04T08:00:00.000Z"))).toMatchObject({ freeNowDay: null, termsWorse: true, needsCheck: true });
    // A quote that showed no cancellation terms: the client saw none, the comparison still runs.
    await db.quoteRoom.update({ where: { id: room.id }, data: { freeCancelUntil: "2027-04-07" } });
    await db.quote.update({ where: { id: quoteId }, data: { showCancellation: false } });
    expect(await quoteReview("A", booking, now)).toMatchObject({ clientFreeDay: null, termsWorse: true });
    // A room quoted as non-refundable cannot get worse.
    await db.quoteRoom.update({ where: { id: room.id }, data: { refundable: false, freeCancelUntil: null, clientCancelUntil: null } });
    expect(await quoteReview("A", { ...booking, refundable: false }, now)).toMatchObject({ termsWorse: false });
  });
});

describe("finding the quoted rate again (the supplier gave it a new id)", () => {
  const quoted = { roomId: "room-1", rateId: "old-rate", bedGroupId: "old-bed", refundable: true, bedDescription: "1 King Bed", amenities: ["Breakfast"], netMinor: 100_000 };
  const offer = (over: Partial<Offer> & { total: number }): Offer => ({
    propertyId: "11",
    roomId: "room-1",
    roomName: "Room",
    rateId: `rate-${over.total}-${(over.amenities ?? ["Breakfast"]).join("")}-${over.refundable ?? true}`,
    refundable: true,
    bedGroups: [{ id: "bed-new", description: "1 King Bed", priceCheckToken: "t" }],
    cancelPenalties: [],
    nonrefundableDateRanges: [],
    amenities: ["Breakfast"],
    price: { total: { minor: over.total, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
    roomPrices: [],
    ...over,
  });

  it("the same rate and bed type win when the supplier still has them", () => {
    const same = offer({ total: 150_000, rateId: "old-rate", bedGroups: [{ id: "old-bed", description: "1 King Bed", priceCheckToken: "t" }] });
    expect(matchRate([offer({ total: 100_000 }), same], quoted)).toEqual({ offer: same, bedGroupId: "old-bed" });
  });

  it("never another board: room only does not stand in for breakfast, nor half board", () => {
    expect(matchRate([offer({ total: 90_000, amenities: [] }), offer({ total: 120_000, amenities: ["Breakfast", "Dinner"] })], quoted)).toBeNull();
  });

  it("never other refund terms, another room or another bed type", () => {
    expect(matchRate([offer({ total: 95_000, refundable: false })], quoted)).toBeNull();
    expect(matchRate([offer({ total: 100_000, roomId: "room-2" })], quoted)).toBeNull();
    expect(matchRate([offer({ total: 100_000, bedGroups: [{ id: "b", description: "2 Twin Beds", priceCheckToken: "t" }] })], quoted)).toBeNull();
  });

  it("of several rates that fit, the one closest in price to what was quoted (not the first in the list)", () => {
    const far = offer({ total: 140_000 });
    const near = offer({ total: 103_000 });
    expect(matchRate([far, near], quoted)?.offer).toBe(near);
    expect(matchRate([near, far], quoted)?.offer).toBe(near);
  });
});

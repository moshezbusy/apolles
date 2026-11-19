import { beforeEach, describe, expect, it, vi } from "vitest";
import { book, cancel, cancelQuote, createDraft, prepareReview, reconcile } from "@/server/booking/service";
import { createClient, addCompanion } from "@/server/clients";
import { db } from "@/server/db";
import { addFromSearch, removeRoom, removeStay, updateQuoteSettings } from "@/server/quotes/quotes";
import { shareLink, submitSelection } from "@/server/quotes/sharing";
import { bookingPrefill, prepareQuoteBooking, stayBookings } from "@/server/quotes/quote-booking";
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

  it("the room is gone at the hotel: says so", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const empty = supplier({ searchAvailability: async () => [] });
    expect(await prepareQuoteBooking(ctx(), stay!.id, { adapter: empty, now: NOW })).toEqual({
      ok: false,
      error: "This room is no longer available at this hotel for these dates. Search the hotel again for other rooms.",
    });
  });

  it("booking the only destination marks the quote booked; the stay shows the booking", async () => {
    const [stay] = await quoteStays();
    await pick(stay!.id, stay!.rooms[0]!.id);
    const { bookingId, outcome } = await bookStay(stay!.id);
    expect(outcome.kind).toBe("confirmed");
    // The quote's 10% markup goes with the booking, as its selling price (reports only).
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ quoteId, quoteStayId: stay!.id, status: "CONFIRMED", sellMarkupType: "PERCENT", sellMarkupValue: 1000 });
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
    expect(await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).toMatchObject({ sellMarkupType: null, sellMarkupValue: null });
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

  it("the client skipped a destination: booking the other one books the quote", async () => {
    await addStay("2027-04-12", "2027-04-15");
    const [first] = await quoteStays();
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
    const charge = cancelQuote(booking, later(10));
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
    // The other destination still changes; un-picking it leaves only booked picks: the quote is booked.
    expect(await submitSelection(token, { picks: { [first!.id]: first!.rooms[0]!.id }, note: "" }, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "BOOKED" });
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

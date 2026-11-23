import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatUsd } from "@/lib/money";
import { requireAgent } from "@/server/auth/guards";
import { db } from "@/server/db";
import { QUOTE_CHECK_NEEDED } from "@/server/quotes/quote-booking";
import { addFromSearch, updateQuoteSettings } from "@/server/quotes/quotes";
import { startSearch } from "@/server/search/search";
import type { Offer } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";

// Booking from a quote, through the pages and actions (scan fixes): the review page sets what the
// client was quoted against the rate now and asks for a tick when it is worse (checked on the
// server), and a picked room that is gone leads to the hotel's other rooms.

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: vi.fn(() => ({ replace: vi.fn(), refresh: vi.fn() })),
  usePathname: vi.fn(() => "/book/new"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "user-agent": "TestBrowser/1.0" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function signInAs(agencyId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId: `u-${agencyId}`, agencyId });
}
function iso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}
async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const m = /NEXT_REDIRECT:(.+)$/.exec((error as Error).message);
    if (m) return m[1]!;
    throw error;
  }
  throw new Error("no redirect");
}

const guests = { r0_given_0: "Daniel", r0_family_0: "Levy", r0_given_1: "Maya", r0_family_1: "Levy", leadEmail: "daniel@example.com", phoneCountry: "972", phoneNumber: "50-123-4567" };

let quoteId: string;
let stayId: string;
let roomId: string;
let net: number;

// A quote of agency A with one refundable room of the fake supplier at a 10% markup, picked by the client.
async function seed() {
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: 2_000_000, reason: "test", idempotencyKey: "seed" });
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
  const { snapshotId } = await startSearch({ agencyId: "A", userId: "u-A", supplierContext: {} }, { destinationId: "paris", checkin: iso(30), checkout: iso(32), rooms: [{ adults: 2, childAges: [] }] });
  const offers = (await db.searchHotel.findFirstOrThrow({ where: { snapshotId } })).offers as unknown as Offer[];
  const offer = offers.find((o) => o.refundable) ?? offers[0]!;
  const added = await addFromSearch("u-A", "A", { quoteId: "new", snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id });
  if (!added.ok) throw new Error(added.error);
  quoteId = added.id;
  await updateQuoteSettings("u-A", "A", quoteId, { title: "Paris", clientId: "", language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" });
  const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId }, include: { hotels: { include: { rooms: true } } } });
  stayId = stay.id;
  roomId = stay.hotels[0]!.rooms[0]!.id;
  net = stay.hotels[0]!.rooms[0]!.netMinor;
  await db.quoteStay.update({ where: { id: stayId }, data: { selectedRoomId: roomId } });
  await db.quote.update({ where: { id: quoteId }, data: { status: "SELECTED", selectedAt: new Date() } });
}

// "Book this room" on the quote, then guest details: the draft's id.
async function draftFromQuote(): Promise<string> {
  const { bookFromQuoteAction } = await import("./(agent)/quotes/actions");
  const to = await redirectOf(bookFromQuoteAction(null, form({ stayId })));
  const rate = Object.fromEntries(new URL(to, "http://x").searchParams);
  expect(rate.stay).toBe(stayId);
  const { createDraftAction } = await import("./(agent)/book/actions");
  return (await redirectOf(createDraftAction(null, form({ ...rate, ...guests })))).replace("/book/", "");
}

async function reviewPage(id: string): Promise<string> {
  const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
  return renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
}

describe("review and book from a quote", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    signInAs("A");
    await seed();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("nothing changed since the quote: the box shows what the client was quoted, and booking needs no extra tick", async () => {
    const id = await draftFromQuote();
    const quoted = net + Math.floor((net * 1000 + 5_000) / 10_000);
    const html = await reviewPage(id);
    expect(html).toContain("From quote");
    expect(html).toContain(`href="/quotes/${quoteId}#selections"`);
    expect(html).toContain("Q-1");
    expect(html).toContain("Price quoted to the client");
    expect(html).toContain(formatUsd(quoted));
    expect(html).toContain("Your profit");
    expect(html).toContain(formatUsd(quoted - net));
    expect(html).toContain("as good as what the client was quoted");
    expect(html).not.toContain('name="quoteChecked"');
    const { bookAction } = await import("./(agent)/book/actions");
    expect(await redirectOf(bookAction(null, form({ bookingId: id, expectedTotal: String(net), acceptedTerms: "on" })))).toBe(`/bookings/${id}`);
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "CONFIRMED", sellMinor: quoted, quoteId, quoteStayId: stayId });
    expect(await db.auditLog.count({ where: { action: "booking.quote-check" } })).toBe(0);
  });

  it("the net rose since the client chose: the box says so, and 'Book' is refused on the server until the agent ticks 'I checked the new price and terms'", async () => {
    // The client was quoted when the net was 60.00 lower, at a price 100.00 above that net.
    const oldNet = net - 6_000;
    await db.quoteRoom.update({ where: { id: roomId }, data: { netMinor: oldNet, sellMinor: oldNet + 10_000 } });
    await db.quoteStay.update({ where: { id: stayId }, data: { selectedSellMinor: oldNet + 10_000, selectedCurrency: "USD" } });
    const id = await draftFromQuote();
    const html = await reviewPage(id);
    expect(html).toContain(formatUsd(oldNet + 10_000)); // the price quoted to the client
    expect(html).toContain(`was ${formatUsd(oldNet)} when quoted`);
    expect(html).toContain(formatUsd(4_000)); // the profit now
    expect(html).toContain(`was ${formatUsd(10_000)}`);
    expect(html).toContain("Your profit is lower than when the client chose");
    expect(html).toContain('name="quoteChecked"');
    expect(html).toContain("I checked the new price and terms");

    const { bookAction } = await import("./(agent)/book/actions");
    const before = await getBalance("A");
    // The tick is checked on the server: a request without it holds nothing and books nothing.
    expect(await bookAction(null, form({ bookingId: id, expectedTotal: String(net), acceptedTerms: "on" }))).toEqual({ status: "error", message: QUOTE_CHECK_NEEDED });
    expect(await bookAction(null, form({ bookingId: id, expectedTotal: String(net), acceptedTerms: "on", quoteChecked: "yes" }))).toEqual({ status: "error", message: QUOTE_CHECK_NEEDED });
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFT", holdId: null });
    expect(await getBalance("A")).toEqual(before);

    expect(await redirectOf(bookAction(null, form({ bookingId: id, expectedTotal: String(net), acceptedTerms: "on", quoteChecked: "on" })))).toBe(`/bookings/${id}`);
    const booked = await db.booking.findUniqueOrThrow({ where: { id } });
    // The booking keeps the client's price: the report shows a profit of 40.00, not 100.00.
    expect(booked).toMatchObject({ status: "CONFIRMED", chargedMinor: net, sellMinor: oldNet + 10_000, sellMarkupType: "FIXED", sellMarkupValue: 4_000 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "booking.quote-check", targetId: id } });
    expect(audit).toMatchObject({ actorUserId: "u-A", after: { quoteId, profitLower: true, termsWorse: false, rateChanged: false } });
  });

  it("free cancellation ends earlier on the rate now than the client was shown: the box shows it and asks for the tick", async () => {
    // The client was shown free cancellation until a later day than the rate being booked has.
    await db.quoteRoom.update({ where: { id: roomId }, data: { refundable: true, freeCancelUntil: iso(40), clientCancelUntil: iso(39) } });
    const id = await draftFromQuote();
    const html = await reviewPage(id);
    expect(html).toContain("Free cancellation the client saw");
    expect(html).toContain("Free cancellation now");
    expect(html).toContain("The cancellation terms are worse than what was quoted");
    expect(html).toContain('name="quoteChecked"');
  });

  it("another agency cannot book the draft, with or without the tick", async () => {
    const id = await draftFromQuote();
    signInAs("B");
    const { bookAction } = await import("./(agent)/book/actions");
    await expect(bookAction(null, form({ bookingId: id, expectedTotal: String(net), acceptedTerms: "on", quoteChecked: "on" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFT" });
  });
});

describe("the picked room is gone", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
    signInAs("A");
    await seed();
    // The supplier no longer has the quoted room in any form.
    await db.quoteRoom.update({ where: { id: roomId }, data: { roomId: "gone-room", rateId: "gone-rate", bedGroupId: "gone-bed" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("'Book this room' opens the hotel's other rooms with the destination kept; one of them books for the quote, with the 'rate changed' notice", async () => {
    const { bookFromQuoteAction } = await import("./(agent)/quotes/actions");
    const to = await redirectOf(bookFromQuoteAction(null, form({ stayId })));
    expect(to).toMatch(new RegExp(`^/quotes/${quoteId}/rooms/${stayId}\\?s=`));
    const snapshotId = new URL(to, "http://x").searchParams.get("s") ?? "";
    // Nothing was lost: the destination and the client's pick are as they were.
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stayId } })).toMatchObject({ selectedRoomId: roomId });

    const { default: RoomsPage } = await import("./(agent)/quotes/[id]/rooms/[stayId]/page");
    const html = renderToStaticMarkup(await RoomsPage({ params: Promise.resolve({ id: quoteId, stayId }), searchParams: Promise.resolve({ s: snapshotId }) }));
    expect(html).toContain("Choose another room");
    expect(html).toContain("This room is no longer available at this hotel for these dates.");
    const href = /href="(\/book\/new\?[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const rate = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(rate).toMatchObject({ s: snapshotId, p: "11", stay: stayId });

    const { createDraftAction } = await import("./(agent)/book/actions");
    const id = (await redirectOf(createDraftAction(null, form({ ...rate, ...guests })))).replace("/book/", "");
    expect(await db.booking.findUniqueOrThrow({ where: { id } })).toMatchObject({ quoteId, quoteStayId: stayId });
    const review = await reviewPage(id);
    expect(review).toContain("The rate changed.");
    expect(review).toContain('name="quoteChecked"');

    // Another agency sees none of it.
    signInAs("B");
    await expect(RoomsPage({ params: Promise.resolve({ id: quoteId, stayId }), searchParams: Promise.resolve({ s: snapshotId }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

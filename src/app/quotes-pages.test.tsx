import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import { addFromSearch, createQuote, getQuote } from "@/server/quotes/quotes";
import type { Offer } from "@/server/supplier/types";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // "Add to quote" on the hotel page reads and updates the page URL.
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/search/x/hotels/p1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let snapshotId: string;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function signInAs(agencyId: string, userId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId, sessionId: "session-1" });
}

const OFFER: Offer = {
  propertyId: "p1",
  roomId: "room1",
  roomName: "Ocean View King",
  rateId: "rate1",
  refundable: true,
  bedGroups: [{ id: "bed1", description: "1 King Bed", priceCheckToken: "secret-token" }],
  cancelPenalties: [{ start: "2099-04-03T00:00:00.000+02:00", end: "2099-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }],
  nonrefundableDateRanges: [],
    amenities: [],
  price: { total: { minor: 100_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
  roomPrices: [{ total: { minor: 100_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }],
};

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(requireAgent).mockReset();
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
  await db.destination.create({ data: { id: "cancun", name: "Cancun", nameFull: "Cancun, Mexico", type: "city", countryCode: "MX", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "p1", name: "Secrets The Vine", city: "Cancun", countryCode: "MX", starRating: "5.0", expediaCollect: true, catalogSeenRunId: "r" } });
  const snapshot = await db.searchSnapshot.create({
    data: {
      agencyId: agencyA,
      userId: agentA,
      query: { destinationId: "cancun", checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [], countryCode: "IL" },
      candidateIds: ["p1"],
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  snapshotId = snapshot.id;
  await db.searchHotel.create({
    data: { snapshotId, propertyId: "p1", position: 0, name: "Secrets The Vine", city: "Cancun", minTotalMinor: 100_000, currency: "USD", refundableAvailable: true, offers: [OFFER] as never },
  });
  signInAs(agencyA, agentA);
});

describe("quote screens", () => {
  it("the list shows only the agency's quotes", async () => {
    const mine = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId, propertyId: "p1", rateId: "rate1", bedGroupId: "bed1" });
    if (!mine.ok) throw new Error(mine.error);
    await db.quote.update({ where: { id: mine.id }, data: { title: "Mexico Honeymoon" } });
    await createQuote(agentB, agencyB);
    await db.quote.updateMany({ where: { agencyId: agencyB }, data: { title: "Their secret quote" } });
    const { default: Page } = await import("./(agent)/quotes/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Mexico Honeymoon");
    expect(html).toContain("1 hotel · 1 room");
    expect(html).not.toContain("Their secret quote");
  });

  it("the editor shows the quote's rooms with net, selling price and the client's cancellation date", async () => {
    const mine = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId, propertyId: "p1", rateId: "rate1", bedGroupId: "bed1" });
    if (!mine.ok) throw new Error(mine.error);
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    const html = renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: mine.id }) }));
    expect(html).toContain("Secrets The Vine");
    expect(html).toContain("Ocean View King");
    expect(html).toContain("USD 1,000.00");
    expect(html).toContain("client sees");
    expect(html).not.toContain("secret-token");
  });

  it("another agency's quote is not found", async () => {
    const theirs = await createQuote(agentB, agencyB);
    if (!theirs.ok) throw new Error("setup");
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    await expect(Editor({ params: Promise.resolve({ id: theirs.id }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("quote actions", () => {
  it("New quote creates a draft for the session's agency (with its client) and opens it", async () => {
    const client = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972501234567", email: "", nationality: "IL", notes: "" });
    if (!client.ok) throw new Error("setup");
    const { createQuoteAction } = await import("./(agent)/quotes/actions");
    await expect(createQuoteAction(form({ clientId: client.id, agencyId: agencyB }))).rejects.toThrow(/NEXT_REDIRECT:\/quotes\//);
    const quote = await db.quote.findFirstOrThrow({ where: { agencyId: agencyA } });
    expect(quote.clientId).toBe(client.id);
    expect(await db.quote.count({ where: { agencyId: agencyB } })).toBe(0);
  });

  it("Add to quote copies the rate from the agency's own search; another agency gets an error", async () => {
    const { addToQuoteAction } = await import("./(agent)/quotes/actions");
    const ok = await addToQuoteAction(null, form({ quoteId: "new", s: snapshotId, p: "p1", r: "rate1", b: "bed1" }));
    expect(ok).toMatchObject({ status: "success", message: "Added to the quote." });
    signInAs(agencyB, agentB);
    const refused = await addToQuoteAction(null, form({ quoteId: "new", s: snapshotId, p: "p1", r: "rate1", b: "bed1" }));
    expect(refused?.status).toBe("error");
    expect(await db.quote.count({ where: { agencyId: agencyB } })).toBe(0);
  });

  it("Save changes updates the session agency's quote only", async () => {
    const mine = await createQuote(agentA, agencyA);
    if (!mine.ok) throw new Error("setup");
    const fields = { quoteId: mine.id, title: "Paphos October", clientId: "", language: "EN", message: "", showCancellation: "on", markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" };
    signInAs(agencyB, agentB);
    const { saveSettingsAction } = await import("./(agent)/quotes/actions");
    expect((await saveSettingsAction(null, form(fields)))?.status).toBe("error");
    signInAs(agencyA, agentA);
    expect(await saveSettingsAction(null, form(fields))).toEqual({ status: "success", message: "Changes saved." });
    expect(await getQuote(agencyA, mine.id)).toMatchObject({ title: "Paphos October", markupValue: 1000, showCancellation: true });
  });
});

it("the hotel page offers Add to quote with the agency's open quotes", async () => {
  const mine = await createQuote(agentA, agencyA);
  if (!mine.ok) throw new Error("setup");
  await createQuote(agentB, agencyB);
  const { default: HotelPage } = await import("./(agent)/search/[id]/hotels/[propertyId]/page");
  const html = renderToStaticMarkup(
    await HotelPage({ params: Promise.resolve({ id: snapshotId, propertyId: "p1" }), searchParams: Promise.resolve({ quote: mine.id }) }),
  );
  expect(html).toContain("Add to quote");
  expect(html.match(/<option value="([a-z0-9]+)" selected="">/)?.[1]).toBe(mine.id);
  expect(html.match(/<option value="c[a-z0-9]+"/g)?.length).toBe(1);
});

describe("booking from a quote (plan 5d)", () => {
  async function pickedQuote() {
    const added = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId, propertyId: "p1", rateId: "rate1", bedGroupId: "bed1" });
    if (!added.ok) throw new Error(added.error);
    const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId: added.id }, include: { hotels: { include: { rooms: true } } } });
    await db.quoteStay.update({ where: { id: stay.id }, data: { selectedRoomId: stay.hotels[0]!.rooms[0]!.id } });
    await db.quote.update({ where: { id: added.id }, data: { status: "SELECTED", selectedAt: new Date() } });
    return { quoteId: added.id, stayId: stay.id };
  }

  function confirmedBooking(quoteId: string, stayId: string) {
    return db.booking.create({
      data: {
        reference: "APL-QUOTE001", agencyId: agencyA, userId: agentA, status: "CONFIRMED", confirmedAt: new Date("2099-01-05T10:00:00Z"), quoteId, quoteStayId: stayId,
        propertyId: "p1", hotelName: "Secrets The Vine", hotelCity: "Cancun", roomId: "room1", roomName: "Ocean View King", rateId: "rate1", bedGroupId: "bed1", bedDescription: "1 King Bed",
        checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972501234567",
        guests: [], refundable: true, totalMinor: 100_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [],
    amenities: [], priceCheckToken: "tok",
      },
    });
  }

  it("the editor offers 'Book this room' on the client's pick, then shows the booking", async () => {
    const { quoteId, stayId } = await pickedQuote();
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    let html = renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: quoteId }) }));
    expect(html).toContain("Book this room");
    await confirmedBooking(quoteId, stayId);
    html = renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: quoteId }) }));
    expect(html).not.toContain("Book this room");
    expect(html).toContain("APL-QUOTE001");
  });

  it("the list: 'Book selected option' on a selected quote, 'View booking' on a booked one", async () => {
    const { quoteId, stayId } = await pickedQuote();
    const { default: List } = await import("./(agent)/quotes/page");
    let html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/quotes/${quoteId}#selections"`);
    expect(html).toContain("Book selected option");
    const booking = await confirmedBooking(quoteId, stayId);
    await db.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    html = renderToStaticMarkup(await List({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/bookings/${booking.id}"`);
    expect(html).toContain("Secrets The Vine · APL-QUOTE001");
  });

  it("'Book this room' for another agency's quote finds nothing", async () => {
    const { stayId } = await pickedQuote();
    const { bookFromQuoteAction } = await import("./(agent)/quotes/actions");
    signInAs(agencyB, agentB);
    expect(await bookFromQuoteAction(null, form({ stayId }))).toEqual({ status: "error", message: "This quote was not found." });
  });
});

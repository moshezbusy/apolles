import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { getContent } from "@/server/content/content-cache";
import { addFromSearch, closeQuote, updateQuoteSettings } from "@/server/quotes/quotes";
import { NET_PRICE, clientQuote, shareLink } from "@/server/quotes/sharing";
import { hitRateLimit } from "@/server/rate-limit";
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
  // The client page reads the offer again after the server says it changed.
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The browser's cookies and address, set by a test (none by default).
const browser: { session: string | null; forwardedFor: string | null } = { session: null, forwardedFor: null };
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers(browser.forwardedFor ? { "x-forwarded-for": browser.forwardedFor } : {})),
  cookies: vi.fn(async () => ({ get: (name: string) => (name === "__Host-apl_session" && browser.session ? { name, value: browser.session } : undefined) })),
}));
// The real content cache, with the fetching read watched: the public page must never use it.
vi.mock("@/server/content/content-cache", async (original) => {
  const real = await original<typeof import("@/server/content/content-cache")>();
  return { ...real, getContent: vi.fn(real.getContent) };
});
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));
vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn(async () => {}) }));

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let quoteId: string;

const OFFER: Offer = {
  propertyId: "p1",
  roomId: "room1",
  roomName: "Ocean View King",
  rateId: "rate1",
  refundable: true,
  bedGroups: [{ id: "bed1", description: "1 King Bed", priceCheckToken: "secret-token" }],
  cancelPenalties: [{ start: "2099-04-03T00:00:00.000+02:00", end: "2099-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }],
  nonrefundableDateRanges: [],
  amenities: ["Breakfast buffet"],
  price: { total: { minor: 100_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
  roomPrices: [{ total: { minor: 100_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 }],
};

function signInAs(agencyId: string, userId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId });
}

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(requireAgent).mockReset();
  vi.mocked(getContent).mockClear();
  browser.session = null;
  browser.forwardedFor = null;
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001", phone: "+972 50 555 0100" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana Cohen", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
  await db.destination.create({ data: { id: "cancun", name: "Cancun", nameFull: "Cancun, Mexico", type: "city", countryCode: "MX", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "p1", name: "Secrets The Vine", city: "Cancun", countryCode: "MX", starRating: "5.0", expediaCollect: true, catalogSeenRunId: "r" } });
  const snapshot = await db.searchSnapshot.create({
    data: {
      agencyId: agencyA, userId: agentA,
      query: { destinationId: "cancun", checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [], countryCode: "IL" },
      candidateIds: ["p1"], createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  await db.searchHotel.create({
    data: { snapshotId: snapshot.id, propertyId: "p1", position: 0, name: "Secrets The Vine", city: "Cancun", minTotalMinor: 100_000, currency: "USD", refundableAvailable: true, offers: [OFFER] as never },
  });
  const added = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId: snapshot.id, propertyId: "p1", rateId: "rate1", bedGroupId: "bed1" });
  if (!added.ok) throw new Error(added.error);
  quoteId = added.id;
  const client = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "daniel@example.com", nationality: "IL", notes: "" });
  if (!client.ok) throw new Error("setup");
  await updateQuoteSettings(agentA, agencyA, quoteId, {
    title: "Mexico Honeymoon", clientId: client.id, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "",
  });
  signInAs(agencyA, agentA);
});

async function renderClientPage(token: string): Promise<string> {
  const { default: Page } = await import("./q/[token]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token }) }));
}

async function sharedToken(): Promise<string> {
  const shared = await shareLink(agentA, agencyA, quoteId, "link");
  if (!shared.ok) throw new Error(shared.error);
  return shared.url.split("/q/")[1] ?? "";
}

// The price the page shows for a room (what the client's browser sends back with a choice).
async function shownPrice(token: string, roomId: string): Promise<number> {
  const rooms = (await clientQuote(token))?.view.stays.flatMap((s) => s.hotels.flatMap((h) => h.rooms)) ?? [];
  return rooms.find((r) => r.id === roomId)?.sellMinor ?? -1;
}

describe("client page /q/[token]", () => {
  it("shows the agency, the quote and the selling price only, in English", async () => {
    const shared = await shareLink(agentA, agencyA, quoteId, "link");
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    const html = await renderClientPage(token);
    expect(html).toContain("Sunrise Travel");
    expect(html).toContain("Mexico Honeymoon");
    expect(html).toContain("Hi Daniel");
    expect(html).toContain("USD 1,100.00");
    // What the rate includes reaches the client page as the supplier named it (plan 8f).
    expect(JSON.stringify(await clientQuote(token))).toContain('"amenities":["Breakfast buffet"]');
    expect(html).toContain("https://wa.me/972505550100");
    expect(html).not.toContain("USD 1,000.00");
    expect(html).not.toMatch(/expedia/i);
    expect(html).not.toContain("Apolles");
  });

  it("in Hebrew the page is right to left with Hebrew words", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { language: "HE" } });
    const shared = await shareLink(agentA, agencyA, quoteId, "link");
    const html = await renderClientPage(shared.ok ? (shared.url.split("/q/")[1] ?? "") : "");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("בחרו את המלונות");
    expect(html).toContain("וואטסאפ");
  });

  it("the link preview shows the agency and the quote's name: nothing of Apolles, no description, never indexed", async () => {
    const token = await sharedToken();
    const { generateMetadata } = await import("./q/[token]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ token }) });
    expect(meta).toEqual({
      title: "Sunrise Travel · Mexico Honeymoon",
      description: "",
      robots: { index: false, follow: false },
      openGraph: { title: "Sunrise Travel · Mexico Honeymoon", description: "", locale: "en_US" },
    });
    expect(JSON.stringify(meta)).not.toMatch(/apolles|B2B|travel agents/i);
    await db.quote.update({ where: { id: quoteId }, data: { language: "HE" } });
    expect((await generateMetadata({ params: Promise.resolve({ token }) })).openGraph).toMatchObject({ locale: "he_IL" });
    // A link that opens nothing gives a neutral title, still without Apolles.
    expect(await generateMetadata({ params: Promise.resolve({ token: "A".repeat(32) }) })).toMatchObject({ title: "Travel proposal", description: "", robots: { index: false, follow: false } });
  });

  it("shows until when the prices are valid; after that it says the offer expired and nothing can be chosen", async () => {
    const token = await sharedToken();
    let html = await renderClientPage(token);
    expect(html).toContain("Prices valid until");
    expect(html).toContain("Send my selections");
    // The offer's last day passed three weeks ago.
    await db.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() - 21 * 86_400_000) } });
    html = await renderClientPage(token);
    expect(html).toContain("This offer has expired. Ask your travel advisor for updated prices.");
    expect(html).not.toContain("Prices valid until");
    expect(html).not.toContain("Send my selections");
    const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId }, include: { hotels: { include: { rooms: true } } } });
    const roomId = stay.hotels[0]?.rooms[0]?.id ?? "";
    const { submitSelectionAction } = await import("./q/[token]/actions");
    expect(await submitSelectionAction(token, { [stay.id]: roomId }, "", { [roomId]: 110_000 })).toEqual({ ok: false, error: "expired" });
  });

  it("a free cancellation date that passed is shown as ended, never as available", async () => {
    const token = await sharedToken();
    // The client's pick: its hotel is drawn open, with its rooms.
    const room = await db.quoteRoom.findFirstOrThrow({ where: { hotel: { stay: { quoteId } } } });
    await db.quoteStay.updateMany({ where: { quoteId }, data: { selectedRoomId: room.id } });
    expect(await renderClientPage(token)).toContain("Free cancellation until Apr 1, 2099");
    await db.quoteRoom.updateMany({ data: { freeCancelUntil: "2026-11-21", clientCancelUntil: "2026-11-20" } });
    const html = await renderClientPage(token);
    expect(html).toContain("Free cancellation ended on Nov 20, 2026");
    expect(html).not.toContain("Free cancellation until");
  });

  it("a closed quote is read-only with a neutral message", async () => {
    const token = await sharedToken();
    await closeQuote(agentA, agencyA, quoteId);
    const html = await renderClientPage(token);
    expect(html).toContain("This proposal is closed");
    expect(html).not.toContain("Send my selections");
  });

  it("a booked destination shows as Confirmed while the other one can still be chosen", async () => {
    const token = await sharedToken();
    const first = await db.quoteStay.findFirstOrThrow({ where: { quoteId }, include: { hotels: { include: { rooms: true } } } });
    const room = first.hotels[0]!.rooms[0]!;
    // A second destination with its own room, and a confirmed booking on the first.
    const second = await db.quoteStay.create({ data: { quoteId, destinationId: "cancun", destinationName: "Tulum, Mexico", checkin: "2099-04-12", checkout: "2099-04-14", position: 1 } });
    const hotel = await db.quoteHotel.create({ data: { stayId: second.id, propertyId: "p1", name: "Tulum Hotel", city: "Tulum", position: 0 } });
    await db.quoteRoom.create({ data: { hotelId: hotel.id, roomId: "x", rateId: "x", bedGroupId: "x", roomName: "Garden Room", bedDescription: "1 King Bed", refundable: false, netMinor: 50_000, currency: "USD", price: {}, position: 0 } });
    await db.quoteStay.update({ where: { id: first.id }, data: { selectedRoomId: room.id } });
    await db.booking.create({
      data: {
        reference: "APL-PART0001", agencyId: agencyA, userId: agentA, status: "CONFIRMED", quoteId, quoteStayId: first.id,
        propertyId: "p1", hotelName: "Secrets The Vine", hotelCity: "Cancun", roomId: "room1", roomName: "Ocean View King", rateId: "rate1", bedGroupId: "bed1", bedDescription: "1 King Bed",
        checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [], leadGivenName: "Dana", leadFamilyName: "Levi", leadEmail: "dana@example.com", leadPhone: "+972501234567",
        guests: [], refundable: true, totalMinor: 100_000, currency: "USD", price: {}, cancelPenalties: [], nonrefundableDateRanges: [], amenities: [], priceCheckToken: "tok",
      },
    });
    const html = await renderClientPage(token);
    expect(html).toContain("Confirmed");
    expect(html).toContain("Send my selections");
    expect((await clientQuote(token))?.view).toMatchObject({ state: "open", stays: [{ booked: true, confirmed: true }, { booked: false }] });
  });

  it("reads hotel photos from our own cache only: the public page never asks the supplier, however old the cache is", async () => {
    const token = await sharedToken();
    const content = {
      propertyId: "p1", name: "Secrets The Vine", address: { line1: "1 Main", city: "Cancun", stateProvince: null, postalCode: null, countryCode: "MX" }, starRating: "5.0", coordinates: null,
      heroImage: { url: "https://i.travelapi.com/hotels/p1/hero.jpg", caption: null }, images: [], amenities: [],
      checkin: { beginTime: null, endTime: null, instructions: null, specialInstructions: null, minAge: null }, checkout: { time: null }, fees: { mandatory: null, optional: null },
      knowBeforeYouGo: null, description: null, onsiteCurrency: null, rooms: [],
    };
    // Nothing cached: the page works without a photo, and nothing is fetched.
    expect(await renderClientPage(token)).not.toContain("i.travelapi.com");
    // Cached 40 days ago (too old for a search page, which would fetch again).
    await db.propertyContentCache.create({ data: { propertyId: "p1", data: content, fetchedAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect(await renderClientPage(token)).toContain("https://i.travelapi.com/hotels/p1/hero.jpg");
    expect(vi.mocked(getContent)).not.toHaveBeenCalled();
  });

  it("opening the page is limited per IP whatever the link: too many loads get a short notice and read nothing", async () => {
    const token = await sharedToken();
    browser.forwardedFor = "198.51.100.20";
    for (let i = 0; i < 60; i++) await hitRateLimit("quote-page:ip:198.51.100.20", 60, 60_000);
    const html = await renderClientPage(token);
    expect(html).toContain("Too many requests");
    expect(html).toContain("יותר מדי בקשות");
    expect(html).not.toContain("Mexico Honeymoon");
    // The same address is limited on any other link too; another address is not.
    expect(await renderClientPage("B".repeat(32))).toContain("Too many requests");
    browser.forwardedFor = "198.51.100.21";
    expect(await renderClientPage(token)).toContain("Mexico Honeymoon");
  });

  it("the agency's own agent opening the link is not counted as the client's view; the client is", async () => {
    const token = await sharedToken();
    const { recordViewAction } = await import("./q/[token]/actions");
    // An agent of the quote's agency is signed in on this browser.
    browser.session = await createSession(agentA, { verified: true });
    await recordViewAction(token);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT", viewCount: 0, viewedAt: null });
    // An agent of another agency, and a browser with no session, are views.
    browser.session = await createSession(agentB, { verified: true });
    await recordViewAction(token);
    browser.session = null;
    await recordViewAction(token);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "VIEWED", viewCount: 2 });
  });

  it("a choice sent with a price the page no longer shows is not recorded: the page asks to review", async () => {
    const token = await sharedToken();
    const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId }, include: { hotels: { include: { rooms: true } } } });
    const roomId = stay.hotels[0]?.rooms[0]?.id ?? "";
    const { submitSelectionAction } = await import("./q/[token]/actions");
    expect(await submitSelectionAction(token, { [stay.id]: roomId }, "", { [roomId]: 99_999 })).toEqual({ ok: false, error: "prices" });
    // Values that are not whole numbers are dropped by the action, so they count as "no price seen".
    expect(await submitSelectionAction(token, { [stay.id]: roomId }, "", { [roomId]: "110000" } as never)).toEqual({ ok: false, error: "prices" });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: null });
    expect(await submitSelectionAction(token, { [stay.id]: roomId }, "", { [roomId]: await shownPrice(token, roomId) })).toEqual({ ok: true });
  });

  it("an unknown link answers 404 with the client's 'not available' page in both languages", async () => {
    await expect(renderClientPage("A".repeat(32))).rejects.toThrow("NEXT_NOT_FOUND");
    const { default: NotFound } = await import("./q/[token]/not-found");
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("This proposal link is not available");
    expect(html).toContain("הקישור להצעה לא זמין");
    expect(html).not.toContain("/search");
  });
});

describe("agent side", () => {
  it("Preview shows the client page for the agency's own quote only", async () => {
    const { default: Preview } = await import("./(agent)/quotes/[id]/preview/page");
    const html = renderToStaticMarkup(await Preview({ params: Promise.resolve({ id: quoteId }) }));
    expect(html).toContain("Preview: this is what your client sees.");
    expect(html).toContain("USD 1,100.00");
    signInAs(agencyB, agentB);
    await expect(Preview({ params: Promise.resolve({ id: quoteId }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("send actions work for the session's agency only, and mark the quote sent", async () => {
    const { copyLinkAction, whatsappAction, emailAction } = await import("./(agent)/quotes/actions");
    signInAs(agencyB, agentB);
    expect((await copyLinkAction(quoteId)).ok).toBe(false);
    expect((await whatsappAction(quoteId)).ok).toBe(false);
    expect((await emailAction(quoteId)).ok).toBe(false);
    signInAs(agencyA, agentA);
    const copied = await copyLinkAction(quoteId);
    expect(copied).toMatchObject({ ok: true, url: expect.stringMatching(/\/q\/[A-Za-z0-9_-]{32}$/) });
    expect(await whatsappAction(quoteId)).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/wa\.me\/972501234567\?text=/) });
    expect(await emailAction(quoteId)).toEqual({ ok: true, message: "Email sent to the client." });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT" });
  });

  it("the editor shows the client's selections once sent", async () => {
    const shared = await shareLink(agentA, agencyA, quoteId, "link");
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId }, include: { hotels: { include: { rooms: true } } } });
    const { submitSelectionAction } = await import("./q/[token]/actions");
    const roomId = stay.hotels[0]?.rooms[0]?.id ?? "";
    expect(await submitSelectionAction(token, { [stay.id]: roomId }, "Sea view please", { [roomId]: await shownPrice(token, roomId) })).toEqual({ ok: true });
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    const html = renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: quoteId }) }));
    expect(html).toContain("Client selections");
    expect(html).toContain("1 of 1 destinations selected");
    expect(html).toContain("Client note: Sea view please");
  });
  it("the editor: offer status with Close quote, the phone hint, and Extend offer once the offer ran out", async () => {
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    const render = async () => renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: quoteId }) }));
    let html = await render();
    expect(html).toContain("Not sent yet.");
    expect(html).toContain("Close quote");
    expect(html).not.toContain("Extend offer");
    expect(html).not.toContain("Add the country code");
    await sharedToken();
    expect(await render()).toContain("The client sees: prices valid until");
    // A client phone typed the local way that cannot be made international for sure.
    await db.client.updateMany({ data: { phone: "972 50 123 4567" } });
    await db.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() - 86_400_000) } });
    html = await render();
    expect(html).toContain("Add the country code to this phone number");
    expect(html).toContain("This offer expired");
    expect(html).toContain("Extend offer");
    expect(html).toContain("Expired");
    const { extendOfferAction, closeQuoteAction, reopenQuoteAction } = await import("./(agent)/quotes/actions");
    const form = new FormData();
    form.set("quoteId", quoteId);
    // Another agency's agent cannot extend, close or reopen it.
    signInAs(agencyB, agentB);
    for (const action of [extendOfferAction, closeQuoteAction, reopenQuoteAction]) expect((await action(null, form))?.status).toBe("error");
    signInAs(agencyA, agentA);
    expect(await extendOfferAction(null, form)).toMatchObject({ status: "success" });
    expect(await render()).not.toContain("This offer expired");
    expect(await closeQuoteAction(null, form)).toMatchObject({ status: "success" });
    html = await render();
    expect(html).toContain("Reopen quote");
    expect(html).toContain("This quote is closed");
    expect(await reopenQuoteAction(null, form)).toMatchObject({ status: "success" });
  });

  it("while the settings form holds unsaved changes, Send, Copy link and Preview are off and say why", async () => {
    const { SendPanel } = await import("./(agent)/quotes/[id]/send-panel");
    const { QuoteDirtyProvider } = await import("./(agent)/quotes/[id]/dirty");
    const never = async () => ({ ok: true }) as const;
    const panel = (dirty: boolean) =>
      renderToStaticMarkup(
        <QuoteDirtyProvider initialDirty={dirty}>
          <SendPanel quoteId={quoteId} shareUrl={null} hasClient hasEmail phoneHint={null} closed={false} actions={{ copy: never, whatsapp: never, email: never, renew: never }} />
        </QuoteDirtyProvider>,
      );
    const saved = panel(false);
    expect(saved).not.toContain("Save your changes first");
    expect(saved).not.toMatch(/<button[^>]*disabled=""/);
    expect(saved).toContain(`href="/quotes/${quoteId}/preview"`);
    // A markup typed and not saved: the client would get net prices, so nothing can be sent.
    const unsaved = panel(true);
    expect(unsaved).toContain("Save your changes first");
    expect(unsaved.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(unsaved).not.toContain(`href="/quotes/${quoteId}/preview"`);
  });

  it("a quote with no saved markup is sent only after 'send at cost price' is confirmed", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { markupValue: 0 } });
    const { copyLinkAction, whatsappAction, emailAction } = await import("./(agent)/quotes/actions");
    for (const action of [copyLinkAction, whatsappAction, emailAction]) expect(await action(quoteId)).toEqual({ ok: false, error: NET_PRICE, confirm: "netPrice" });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", shareToken: null });
    // Only a real yes counts.
    expect((await copyLinkAction(quoteId, "yes" as never)).ok).toBe(false);
    expect((await copyLinkAction(quoteId, true)).ok).toBe(true);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT" });
  });

  it("Save changes with another client asks for the tick first and then says what was removed; a price below net asks too", async () => {
    await sharedToken();
    const other = await createClient(agentA, agencyA, { firstName: "Noa", lastName: "Bar", phone: "+972 50 765 4321", email: "", nationality: "IL", notes: "" });
    if (!other.ok) throw new Error("setup");
    const fields: Record<string, string> = { quoteId, title: "Mexico Honeymoon", clientId: other.id, language: "EN", message: "", showCancellation: "on", markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" };
    const data = (extra: Record<string, string> = {}) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...fields, ...extra })) form.set(key, value);
      return form;
    };
    const { saveSettingsAction, roomPriceAction } = await import("./(agent)/quotes/actions");
    const asked = await saveSettingsAction(null, data());
    expect(asked).toMatchObject({ status: "error", message: expect.stringContaining("stops the client link"), confirm: { name: "confirmClientChange" } });
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).shareToken).not.toBeNull();
    expect(await saveSettingsAction(null, data({ confirmClientChange: "on" }))).toEqual({
      status: "success",
      message: "Changes saved. The old client link no longer works, and the selections and note of the previous client were removed. Send the quote to the new client.",
    });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ clientId: other.id, shareToken: null, status: "DRAFT" });

    const room = await db.quoteRoom.findFirstOrThrow({ where: { hotel: { stay: { quoteId } } } });
    const price = (extra: Record<string, string> = {}) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ roomId: room.id, price: "100", ...extra })) form.set(key, value);
      return form;
    };
    expect(await roomPriceAction(null, price())).toMatchObject({ status: "error", confirm: { name: "confirmBelowNet" } });
    expect((await db.quoteRoom.findUniqueOrThrow({ where: { id: room.id } })).sellMinor).toBeNull();
    expect(await roomPriceAction(null, price({ confirmBelowNet: "on" }))).toBeNull();
    expect((await db.quoteRoom.findUniqueOrThrow({ where: { id: room.id } })).sellMinor).toBe(10_000);
    expect(await roomPriceAction(null, price({ price: "0", confirmBelowNet: "on" }))).toMatchObject({ status: "error", message: expect.stringContaining("cannot be 0") });
  });
});

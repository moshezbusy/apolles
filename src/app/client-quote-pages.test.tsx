import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import { addFromSearch, updateQuoteSettings } from "@/server/quotes/quotes";
import { shareLink } from "@/server/quotes/sharing";
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
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
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
  price: { total: { minor: 100_000, currency: "USD" }, lines: [], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
};

function signInAs(agencyId: string, userId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId });
}

beforeEach(async () => {
  await resetTestDb();
  vi.mocked(requireAgent).mockReset();
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

describe("client page /q/[token]", () => {
  it("shows the agency, the quote and the selling price only, in English", async () => {
    const shared = await shareLink(agentA, agencyA, quoteId, "link");
    const token = shared.ok ? (shared.url.split("/q/")[1] ?? "") : "";
    const html = await renderClientPage(token);
    expect(html).toContain("Sunrise Travel");
    expect(html).toContain("Mexico Honeymoon");
    expect(html).toContain("Hi Daniel");
    expect(html).toContain("USD 1,100.00");
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

  it("an unknown link shows the 'not available' page in both languages", async () => {
    const html = await renderClientPage("A".repeat(32));
    expect(html).toContain("This proposal link is not available");
    expect(html).toContain("הקישור להצעה לא זמין");
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
    expect(await submitSelectionAction(token, { [stay.id]: stay.hotels[0]?.rooms[0]?.id ?? "" }, "Sea view please")).toEqual({ ok: true });
    const { default: Editor } = await import("./(agent)/quotes/[id]/page");
    const html = renderToStaticMarkup(await Editor({ params: Promise.resolve({ id: quoteId }) }));
    expect(html).toContain("Client selections");
    expect(html).toContain("1 of 1 destinations selected");
    expect(html).toContain("Client note: Sea view please");
  });
});

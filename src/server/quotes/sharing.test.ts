import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import { addFromSearch, getQuote, removeRoom, updateQuoteSettings } from "@/server/quotes/quotes";
import { sendEmail } from "@/server/email/port";
import { clientQuote, emailQuote, recordView, renewLink, shareLink, shareText, submitSelection, whatsappLink, whatsappUrl } from "@/server/quotes/sharing";
import type { Offer } from "@/server/supplier/types";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

const NOW = new Date();
let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let quoteId: string;

const OFFER = (rateId: string, total: number): Offer => ({
  propertyId: "p1",
  roomId: `room-${rateId}`,
  roomName: `Room ${rateId}`,
  rateId,
  refundable: true,
  bedGroups: [{ id: "bed1", description: "1 King Bed", priceCheckToken: "secret-token" }],
  cancelPenalties: [{ start: "2099-04-03T00:00:00.000+02:00", end: "2099-04-10T00:00:00.000+02:00", amount: null, nights: 1, percent: null }],
  nonrefundableDateRanges: [],
    amenities: [],
  price: {
    total: { minor: total, currency: "USD" },
    lines: [],
    dueAtProperty: [{ kind: "mandatory_tax", amount: { minor: 1200, currency: "USD" }, localAmount: { minor: 21000, currency: "MXN" } }],
    dueAtPropertyTotal: { minor: 1200, currency: "USD" },
    nights: 2,
  },
});

const sent: { to: string; subject: string; text: string; fromName?: string; replyTo?: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string; fromName?: string; replyTo?: string }) => {
    sent.push(m);
  }),
}));

function emailSink(): string {
  return JSON.stringify(sent);
}

beforeEach(async () => {
  await resetTestDb();
  sent.length = 0;
  agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001", phone: "+972 50 555 0100" } })).id;
  agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
  agentA = (await createUser({ email: "a@sunrise.example", name: "Dana Cohen", role: "AGENT", agencyId: agencyA })).id;
  agentB = (await createUser({ email: "b@other.example", name: "Bob", role: "AGENT", agencyId: agencyB })).id;
  await db.destination.create({ data: { id: "cancun", name: "Cancun", nameFull: "Cancun, Mexico", type: "city", countryCode: "MX", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "p1", name: "Secrets The Vine", city: "Cancun", countryCode: "MX", starRating: "5.0", expediaCollect: true, catalogSeenRunId: "r" } });
  const snapshot = await db.searchSnapshot.create({
    data: {
      agencyId: agencyA,
      userId: agentA,
      query: { destinationId: "cancun", checkin: "2099-04-10", checkout: "2099-04-12", adults: 2, childAges: [], countryCode: "IL" },
      candidateIds: ["p1"],
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    },
  });
  await db.searchHotel.create({
    data: { snapshotId: snapshot.id, propertyId: "p1", position: 0, name: "Secrets The Vine", city: "Cancun", minTotalMinor: 100_000, currency: "USD", refundableAvailable: true, offers: [OFFER("r1", 100_000), OFFER("r2", 120_000)] as never },
  });
  const added = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId: snapshot.id, propertyId: "p1", rateId: "r1", bedGroupId: "bed1" });
  if (!added.ok) throw new Error(added.error);
  quoteId = added.id;
  await addFromSearch(agentA, agencyA, { quoteId, snapshotId: snapshot.id, propertyId: "p1", rateId: "r2", bedGroupId: "bed1" });
  const client = await createClient(agentA, agencyA, { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "daniel@example.com", nationality: "IL", notes: "" });
  if (!client.ok) throw new Error("setup");
  await updateQuoteSettings(agentA, agencyA, quoteId, {
    title: "Mexico Honeymoon", clientId: client.id, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "",
  });
});

async function token(): Promise<string> {
  const shared = await shareLink(agentA, agencyA, quoteId, "link");
  if (!shared.ok) throw new Error(shared.error);
  return shared.url.split("/q/")[1] ?? "";
}

describe("sharing", () => {
  it("makes one stable link, marks the quote sent; another agency cannot", async () => {
    expect((await shareLink(agentB, agencyB, quoteId, "link")).ok).toBe(false);
    const first = await shareLink(agentA, agencyA, quoteId, "link");
    const again = await shareLink(agentA, agencyA, quoteId, "link");
    expect(first.ok && again.ok && first.url === again.url).toBe(true);
    expect(first.ok ? first.url : "").toMatch(/^http:\/\/localhost:3000\/q\/[A-Za-z0-9_-]{32}$/);
    expect(await getQuote(agencyA, quoteId)).toMatchObject({ status: "SENT" });
  });

  it("WhatsApp link: the client's number and the message with the link", async () => {
    const wa = await whatsappLink(agentA, agencyA, quoteId);
    expect(wa.ok).toBe(true);
    const url = wa.ok ? new URL(wa.url) : null;
    expect(url?.origin + (url?.pathname ?? "")).toBe("https://wa.me/972501234567");
    expect(url?.searchParams.get("text")).toMatch(/^Hi Daniel, here are the hotel options for your trip\.\n\nhttp:\/\/localhost:3000\/q\//);
    expect(whatsappUrl("00972 50-1", "a b")).toBe("https://wa.me/972501?text=a%20b");
    expect(shareText({ language: "HE", message: "", client: { firstName: "דניאל" } }, "U")).toBe("היי דניאל, הנה אפשרויות המלונות לטיול שלכם.\n\nU");
  });

  it("emails the client the link, or says what is missing", async () => {
    expect(await emailQuote(agentA, agencyA, quoteId)).toEqual({ ok: true });
    expect(emailSink()).toContain("daniel@example.com");
    await db.client.updateMany({ data: { email: null } });
    expect((await emailQuote(agentA, agencyA, quoteId)).ok).toBe(false);
    expect((await emailQuote(agentB, agencyB, quoteId)).ok).toBe(false);
  });

  it("the email is in the agency's name, replies go to the agent", async () => {
    await emailQuote(agentA, agencyA, quoteId);
    expect(sent[0]).toMatchObject({ to: "daniel@example.com", fromName: "Sunrise Travel", replyTo: "a@sunrise.example" });
  });

  it("an email that fails is not marked sent, and says so", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("provider down"));
    const result = await emailQuote(agentA, agencyA, quoteId);
    expect(result.ok).toBe(false);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", sentAt: null });
  });

  it("a new link stops the old one; another agency cannot renew", async () => {
    const old = await token();
    expect((await renewLink(agentB, agencyB, quoteId)).ok).toBe(false);
    const renewed = await renewLink(agentA, agencyA, quoteId);
    const fresh = renewed.ok ? (renewed.url.split("/q/")[1] ?? "") : "";
    expect(fresh).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(fresh).not.toBe(old);
    expect(await clientQuote(old)).toBeNull();
    expect((await clientQuote(fresh))?.view.title).toBe("Mexico Honeymoon");
  });

  it("adding the first client keeps the link", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { clientId: null } });
    const t = await token();
    const client = await db.client.findFirstOrThrow({ where: { agencyId: agencyA } });
    await updateQuoteSettings(agentA, agencyA, quoteId, {
      title: "Mexico Honeymoon", clientId: client.id, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "",
    });
    expect((await clientQuote(t))?.view.title).toBe("Mexico Honeymoon");
  });

  it("another client on the quote withdraws the link, the picks and the note", async () => {
    const t = await token();
    const stay = (await getQuote(agencyA, quoteId))?.stays[0];
    const room = stay?.hotels[0]?.rooms[0];
    if (!stay || !room) throw new Error("setup");
    await submitSelection(t, { picks: { [stay.id]: room.id }, note: "Private note" }, "203.0.113.9");
    const other = await createClient(agentA, agencyA, { firstName: "Noa", lastName: "Bar", phone: "+972 50 765 4321", email: "", nationality: "IL", notes: "" });
    if (!other.ok) throw new Error("setup");
    await updateQuoteSettings(agentA, agencyA, quoteId, {
      title: "Mexico Honeymoon", clientId: other.id, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "",
    });
    expect(await clientQuote(t)).toBeNull();
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", shareToken: null, clientNote: "", selectedAt: null });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: null, selectedSellMinor: null });
  });
});

describe("the client page", () => {
  it("shows selling prices only: never the net, the token of the supplier or ids of the supplier", async () => {
    const view = (await clientQuote(await token()))?.view;
    expect(view?.title).toBe("Mexico Honeymoon");
    expect(view?.agency).toMatchObject({ name: "Sunrise Travel", phone: "+972 50 555 0100" });
    const rooms = view?.stays[0]?.hotels[0]?.rooms ?? [];
    expect(rooms.map((r) => r.sellMinor)).toEqual([110_000, 132_000]);
    expect(rooms[0]).toMatchObject({ freeUntil: "2099-04-01", dueAtHotel: { minor: 1200, currency: "USD", localMinor: 21000, localCurrency: "MXN" } });
    const json = JSON.stringify(view);
    for (const hidden of ["100000", "netMinor", "secret-token", "rateId", "markup", "room-r1", "Levy", '"p1"', "a@sunrise.example"]) expect(json).not.toContain(hidden);
  });

  it("hides the cancellation dates when the quote says so; an unknown or bad token shows nothing", async () => {
    const t = await token();
    await db.quote.update({ where: { id: quoteId }, data: { showCancellation: false } });
    expect((await clientQuote(t))?.view.stays[0]?.hotels[0]?.rooms[0]?.freeUntil).toBeNull();
    expect(await clientQuote("x".repeat(32))).toBeNull();
    expect(await clientQuote("../../etc")).toBeNull();
  });

  it("a suspended agency's link stops working", async () => {
    const t = await token();
    await db.agency.update({ where: { id: agencyA }, data: { status: "SUSPENDED" } });
    expect(await clientQuote(t)).toBeNull();
  });

  it("a view counts and moves Sent to Viewed", async () => {
    const t = await token();
    await recordView(t, "203.0.113.9");
    await recordView(t, "203.0.113.9");
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "VIEWED", viewCount: 2 });
  });

  it("selections: one room per destination from this quote only; the agent is emailed; a removed room clears the pick", async () => {
    const t = await token();
    const quote = await getQuote(agencyA, quoteId);
    const stay = quote?.stays[0];
    const [r1, r2] = stay?.hotels[0]?.rooms ?? [];
    if (!stay || !r1 || !r2) throw new Error("setup");

    expect(await submitSelection(t, { picks: { [stay.id]: "someone-elses-room" }, note: "" }, "203.0.113.9")).toEqual({ ok: false, error: "invalid" });
    expect(await submitSelection(t, { picks: { [stay.id]: r2.id }, note: "High floor,\r\nplease" }, "203.0.113.9")).toEqual({ ok: true });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED", clientNote: "High floor,\nplease" });
    expect((await clientQuote(t))?.view.stays[0]?.selectedRoomId).toBe(r2.id);
    expect(emailSink()).toContain("sent selections");

    await removeRoom(agentA, agencyA, r2.id);
    expect((await clientQuote(t))?.view.stays[0]?.selectedRoomId).toBeNull();
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedSellMinor: null, selectedCurrency: null });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT" });
  });

  it("keeps the price the client saw; the agent is told once per change, not on every click", async () => {
    const t = await token();
    const stay = (await getQuote(agencyA, quoteId))?.stays[0];
    const [r1, r2] = stay?.hotels[0]?.rooms ?? [];
    if (!stay || !r1 || !r2) throw new Error("setup");
    await submitSelection(t, { picks: { [stay.id]: r1.id }, note: "" }, "203.0.113.9");
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedSellMinor: 110_000, selectedCurrency: "USD" });
    await submitSelection(t, { picks: { [stay.id]: r1.id }, note: "" }, "203.0.113.9");
    await submitSelection(t, { picks: { [stay.id]: r2.id }, note: "" }, "203.0.113.9");
    // r1, then r1 again (nothing changed: no email), then r2: two emails.
    expect(sent.filter((m) => m.to === "a@sunrise.example")).toHaveLength(2);
    expect(sent[0]?.subject).toContain("Daniel");
    expect(sent[0]?.subject).not.toContain("Levy");
  });

  it("the agency's quote branding (screen 20) is what the client sees and who the email is from", async () => {
    await db.agency.update({
      where: { id: agencyA },
      data: { quoteDisplayName: "Sunrise Trips", quoteAdvisorName: "Dana C.", quoteContactPhone: "+972 52 000 1111", quoteAdvisorEmail: "dana@trips.example", quoteBrandColor: "#21436b" },
    });
    const view = (await clientQuote(await token()))?.view;
    expect(view?.agency).toMatchObject({ name: "Sunrise Trips", phone: "+972 52 000 1111", brandColor: "#21436b" });
    expect(view?.agentName).toBe("Dana C.");
    await emailQuote(agentA, agencyA, quoteId);
    expect(sent.at(-1)).toMatchObject({ fromName: "Sunrise Trips", replyTo: "dana@trips.example", subject: "Mexico Honeymoon · Sunrise Trips" });
    // A color stored by any other way than the settings form never reaches the page's style.
    await db.agency.update({ where: { id: agencyA }, data: { quoteBrandColor: "red;x:url(y)" } });
    expect((await clientQuote(await token()))?.view.agency.brandColor).toBeNull();
  });

  it("a booked quote cannot change its selections", async () => {
    const t = await token();
    await db.quote.update({ where: { id: quoteId }, data: { status: "BOOKED" } });
    expect(await submitSelection(t, { picks: {}, note: "" }, "203.0.113.9")).toEqual({ ok: false, error: "locked" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/server/clients";
import { db } from "@/server/db";
import { updateQuoteBranding, updateQuoteDefaults } from "@/server/quote-settings";
import { addFromSearch, closeQuote, getQuote, listQuotes, removeRoom, reopenQuote, setRoomPrice, updateQuoteSettings } from "@/server/quotes/quotes";
import { sendEmail } from "@/server/email/port";
import { NET_PRICE, clientPageAllowed, clientQuote, clientQuoteMeta, emailQuote, extendOffer, recordView, renewLink, shareLink, shareText, submitSelection, whatsappLink, whatsappUrl } from "@/server/quotes/sharing";
import { hitRateLimit } from "@/server/rate-limit";
import type { Offer } from "@/server/supplier/types";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

const NOW = new Date();
let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let quoteId: string;

const PRICE = (total: number): Offer["price"] => ({
  total: { minor: total, currency: "USD" },
  lines: [],
  dueAtProperty: [{ kind: "mandatory_tax", amount: { minor: 1200, currency: "USD" }, localAmount: { minor: 21000, currency: "MXN" } }],
  dueAtPropertyTotal: { minor: 1200, currency: "USD" },
  nights: 2,
});

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
  price: PRICE(total),
  roomPrices: [PRICE(total)],
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

async function token(now?: Date): Promise<string> {
  const shared = await shareLink(agentA, agencyA, quoteId, "link", now ? { now } : {});
  if (!shared.ok) throw new Error(shared.error);
  return shared.url.split("/q/")[1] ?? "";
}

const IP = "203.0.113.9";
const DAY = 86_400_000;
const SETTINGS = { title: "Mexico Honeymoon", language: "EN" as const, message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" };

// What the client page does: the choice goes with the price the page showed for each chosen room.
async function choose(t: string, picks: Record<string, string>, note = "", now?: Date) {
  const view = (await clientQuote(t, now))?.view;
  const prices = new Map(view?.stays.flatMap((s) => s.hotels.flatMap((h) => h.rooms.map((r) => [r.id, r.sellMinor] as const))));
  const seen = Object.fromEntries(Object.values(picks).flatMap((id) => (prices.has(id) ? [[id, prices.get(id) as number]] : [])));
  return submitSelection(t, { picks, seen, note }, IP, now);
}

async function firstStay() {
  const stay = (await getQuote(agencyA, quoteId))?.stays[0];
  const [r1, r2] = stay?.hotels[0]?.rooms ?? [];
  if (!stay || !r1 || !r2) throw new Error("setup");
  return { stay, r1, r2 };
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
    expect(whatsappUrl("00972 50-123 4567", "US", "a b")).toBe("https://wa.me/972501234567?text=a%20b");
    expect(shareText({ language: "HE", message: "", client: { firstName: "דניאל" } }, "U")).toBe("היי דניאל, הנה אפשרויות המלונות לטיול שלכם.\n\nU");
  });

  it("a phone typed the local way gets the agency's country code; a number that cannot be made international sends nothing", async () => {
    // Before: "050-123 4567" became wa.me/0501234567, which is nobody's number.
    await db.client.updateMany({ data: { phone: "050-123 4567" } });
    const wa = await whatsappLink(agentA, agencyA, quoteId);
    expect(wa.ok ? new URL(wa.url).pathname : "").toBe("/972501234567");
    expect(whatsappUrl("050-123 4567", "IL", "x")).toBe("https://wa.me/972501234567?text=x");
    // Could be read two ways (with or without the country code): no link, and the quote is not marked sent.
    await db.quote.update({ where: { id: quoteId }, data: { status: "DRAFT", sentAt: null } });
    await db.client.updateMany({ data: { phone: "972 50 123 4567" } });
    const refused = await whatsappLink(agentA, agencyA, quoteId);
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("Add the country code") });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", sentAt: null });
    expect(whatsappUrl("972 50 123 4567", "IL", "x")).toBeNull();
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

  it("another client on the quote is saved only after the agent confirms what is lost; then the link, the picks and the note go", async () => {
    const t = await token();
    const stay = (await getQuote(agencyA, quoteId))?.stays[0];
    const room = stay?.hotels[0]?.rooms[0];
    if (!stay || !room) throw new Error("setup");
    expect(await choose(t, { [stay.id]: room.id }, "Private note")).toEqual({ ok: true });
    const other = await createClient(agentA, agencyA, { firstName: "Noa", lastName: "Bar", phone: "+972 50 765 4321", email: "", nationality: "IL", notes: "" });
    if (!other.ok) throw new Error("setup");
    // Without the confirmation nothing changes: the link still works, the pick and the note stay.
    const asked = await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, title: "New title", clientId: other.id });
    expect(asked).toMatchObject({ ok: false, confirm: "clientChange", error: expect.stringContaining("removes the selections and the note") });
    expect((await clientQuote(t))?.view.title).toBe("Mexico Honeymoon");
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SELECTED", clientNote: "Private note" });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: room.id });
    // With it: saved, and the answer says so.
    expect(await updateQuoteSettings(agentA, agencyA, quoteId, { ...SETTINGS, clientId: other.id, confirmClientChange: true })).toEqual({ ok: true, id: quoteId, clientChanged: true });
    expect(await clientQuote(t)).toBeNull();
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", shareToken: null, clientNote: "", selectedAt: null });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: null, selectedSellMinor: null });
  });
});

describe("the client page", () => {
  it("shows selling prices only: never the net, the token of the supplier or ids of the supplier", async () => {
    const view = (await clientQuote(await token()))?.view;
    expect(view?.title).toBe("Mexico Honeymoon");
    expect(view?.agency).toMatchObject({ name: "Sunrise Travel", phoneE164: "972505550100" });
    const rooms = view?.stays[0]?.hotels[0]?.rooms ?? [];
    expect(rooms.map((r) => r.sellMinor)).toEqual([110_000, 132_000]);
    expect(rooms[0]).toMatchObject({ cancel: { kind: "free", until: "2099-04-01" }, dueAtHotel: { minor: 1200, currency: "USD", localMinor: 21000, localCurrency: "MXN" } });
    const json = JSON.stringify(view);
    for (const hidden of ["100000", "netMinor", "secret-token", "rateId", "markup", "room-r1", "Levy", '"p1"', "a@sunrise.example"]) expect(json).not.toContain(hidden);
  });

  it("hides the cancellation dates when the quote says so; an unknown or bad token shows nothing", async () => {
    const t = await token();
    await db.quote.update({ where: { id: quoteId }, data: { showCancellation: false } });
    expect((await clientQuote(t))?.view.stays[0]?.hotels[0]?.rooms[0]?.cancel).toBeNull();
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

    expect(await choose(t, { [stay.id]: "someone-elses-room" })).toEqual({ ok: false, error: "updated" });
    expect(await choose(t, { [stay.id]: r2.id }, "High floor,\r\nplease")).toEqual({ ok: true });
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
    await choose(t, { [stay.id]: r1.id });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedSellMinor: 110_000, selectedCurrency: "USD" });
    await choose(t, { [stay.id]: r1.id });
    await choose(t, { [stay.id]: r2.id });
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
    expect(view?.agency).toMatchObject({ name: "Sunrise Trips", phoneE164: "972520001111", brandColor: "#21436b" });
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

describe("an offer does not stay open for ever (validity)", () => {
  const SENT = new Date("2026-11-02T09:00:00.000Z");

  it("sharing starts the validity (the agency's days); the client sees the last day, and after it the page is read-only and takes no selection", async () => {
    const t = await token(SENT);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).validUntil?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    const { stay, r1 } = await firstStay();
    const during = new Date("2026-11-08T23:00:00.000Z");
    expect((await clientQuote(t, during))?.view).toMatchObject({ state: "open", validLastDay: "2026-11-08" });
    expect(await choose(t, { [stay.id]: r1.id }, "", during)).toEqual({ ok: true });
    // Three weeks later the link still opens, but nothing can be chosen any more.
    const later = new Date("2026-11-23T10:00:00.000Z");
    expect((await clientQuote(t, later))?.view.state).toBe("expired");
    expect(await choose(t, {}, "", later)).toEqual({ ok: false, error: "expired" });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: r1.id });
    expect((await listQuotes(agencyA, {}, later)).quotes[0]).toMatchObject({ expired: true });
    expect((await listQuotes(agencyA, {}, during)).quotes[0]).toMatchObject({ expired: false });
  });

  it("'Offer valid for (days)' of the agency sets how long; sharing again, a new link and 'Extend offer' start it again", async () => {
    await updateQuoteDefaults(agentA, agencyA, { markupType: "PERCENT", markupValue: "10", showCancellation: true, validDays: "3" });
    const t = await token(SENT);
    const until = async () => (await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).validUntil?.toISOString();
    expect(await until()).toBe("2026-11-05T00:00:00.000Z");
    const later = new Date("2026-11-23T10:00:00.000Z");
    expect((await clientQuote(t, later))?.view.state).toBe("expired");
    // Another agency cannot extend it.
    expect((await extendOffer(agentB, agencyB, quoteId, later)).ok).toBe(false);
    expect(await extendOffer(agentA, agencyA, quoteId, later)).toEqual({ ok: true, id: quoteId });
    expect(await until()).toBe("2026-11-26T00:00:00.000Z");
    expect((await clientQuote(t, later))?.view).toMatchObject({ state: "open", validLastDay: "2026-11-25" });
    expect(await db.auditLog.count({ where: { action: "quote.offer.extend", targetId: quoteId } })).toBe(1);
    await renewLink(agentA, agencyA, quoteId, new Date("2026-12-01T10:00:00.000Z"));
    expect(await until()).toBe("2026-12-04T00:00:00.000Z");
    await token(new Date("2026-12-10T10:00:00.000Z"));
    expect(await until()).toBe("2026-12-13T00:00:00.000Z");
  });

  it("once the check-in of every destination has passed the offer is over, and extending it is refused", async () => {
    const t = await token(SENT);
    await db.quoteStay.updateMany({ where: { quoteId }, data: { checkin: "2026-11-05", checkout: "2026-11-07" } });
    const before = new Date("2026-11-04T12:00:00.000Z");
    const onTheDay = new Date("2026-11-05T00:30:00.000Z");
    expect((await clientQuote(t, before))?.view).toMatchObject({ state: "open", stays: [{ past: false }] });
    expect((await clientQuote(t, onTheDay))?.view).toMatchObject({ state: "expired", stays: [{ past: true }] });
    expect(await choose(t, {}, "", onTheDay)).toEqual({ ok: false, error: "expired" });
    expect(await extendOffer(agentA, agencyA, quoteId, onTheDay)).toMatchObject({ ok: false, error: expect.stringContaining("dates of this quote have passed") });
  });

  it("a free cancellation date that passed is shown as ended, never as available", async () => {
    const t = await token(SENT);
    await db.quoteRoom.updateMany({ where: { hotel: { stay: { quoteId } } }, data: { freeCancelUntil: "2026-11-21", clientCancelUntil: "2026-11-20" } });
    const room = async (now: Date) => (await clientQuote(t, now))?.view.stays[0]?.hotels[0]?.rooms[0]?.cancel;
    expect(await room(new Date("2026-11-10T10:00:00.000Z"))).toEqual({ kind: "free", until: "2026-11-20" });
    // Today is Nov 23: "Free cancellation until Nov 20" must not be on the page.
    expect(await room(new Date("2026-11-23T10:00:00.000Z"))).toEqual({ kind: "ended", on: "2026-11-20" });
  });
});

describe("closing a quote on purpose", () => {
  it("a closed quote is read-only for the client, cannot be sent or edited, and can be reopened; another agency cannot close it", async () => {
    const t = await token();
    const { stay, r1 } = await firstStay();
    expect((await closeQuote(agentB, agencyB, quoteId)).ok).toBe(false);
    expect(await closeQuote(agentA, agencyA, quoteId)).toEqual({ ok: true, id: quoteId });
    expect((await clientQuote(t))?.view.state).toBe("closed");
    expect(await choose(t, { [stay.id]: r1.id })).toEqual({ ok: false, error: "closed" });
    expect(await shareLink(agentA, agencyA, quoteId, "link")).toMatchObject({ ok: false, error: expect.stringContaining("closed") });
    expect((await emailQuote(agentA, agencyA, quoteId)).ok).toBe(false);
    expect((await setRoomPrice(agentA, agencyA, r1.id, "1500")).ok).toBe(false);
    expect((await listQuotes(agencyA, {})).quotes[0]).toMatchObject({ closed: true, expired: false });
    expect((await reopenQuote(agentB, agencyB, quoteId)).ok).toBe(false);
    expect(await reopenQuote(agentA, agencyA, quoteId)).toEqual({ ok: true, id: quoteId });
    expect(await choose(t, { [stay.id]: r1.id })).toEqual({ ok: true });
    expect(await db.auditLog.count({ where: { action: { in: ["quote.close", "quote.reopen"] }, targetId: quoteId } })).toBe(2);
  });
});

describe("a quote with no saved markup is not sent by accident", () => {
  it("0% markup: sending, copying and emailing are refused until the agent confirms; a typed price is the agent's own decision", async () => {
    // The agent typed 10% and never saved: the saved markup is 0, so the client would see the net.
    await db.quote.update({ where: { id: quoteId }, data: { markupValue: 0 } });
    for (const result of [await shareLink(agentA, agencyA, quoteId, "link"), await whatsappLink(agentA, agencyA, quoteId), await emailQuote(agentA, agencyA, quoteId)]) {
      expect(result).toEqual({ ok: false, error: NET_PRICE, confirm: "netPrice" });
    }
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "DRAFT", shareToken: null, sentAt: null });
    expect(sent).toHaveLength(0);
    // Every room has a price the agent typed: nothing to confirm.
    const { r1, r2 } = await firstStay();
    await setRoomPrice(agentA, agencyA, r1.id, "1100");
    await setRoomPrice(agentA, agencyA, r2.id, "1300");
    expect((await shareLink(agentA, agencyA, quoteId, "link")).ok).toBe(true);
    // Back to the markup on one room: asked again, and sent with the explicit yes.
    await setRoomPrice(agentA, agencyA, r2.id, "");
    expect((await shareLink(agentA, agencyA, quoteId, "link")).ok).toBe(false);
    expect((await shareLink(agentA, agencyA, quoteId, "link", { confirmNetPrice: true })).ok).toBe(true);
    expect((await emailQuote(agentA, agencyA, quoteId, { confirmNetPrice: true })).ok).toBe(true);
  });
});

describe("a selection from a page that is out of date", () => {
  it("a price that changed since the page was opened is not recorded: the client is asked to review", async () => {
    const t = await token();
    const { stay, r1 } = await firstStay();
    // The page showed 1,100.00; meanwhile the agent set 1,250.00.
    await setRoomPrice(agentA, agencyA, r1.id, "1250");
    const stale = await submitSelection(t, { picks: { [stay.id]: r1.id }, seen: { [r1.id]: 110_000 }, note: "" }, IP);
    expect(stale).toEqual({ ok: false, error: "prices" });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: null, selectedSellMinor: null });
    expect(sent).toHaveLength(0);
    // A choice sent with no price at all (a made-up request) is not recorded either.
    expect(await submitSelection(t, { picks: { [stay.id]: r1.id }, note: "" }, IP)).toEqual({ ok: false, error: "prices" });
    // After the page shows the new price, the same choice goes through with it.
    expect(await submitSelection(t, { picks: { [stay.id]: r1.id }, seen: { [r1.id]: 125_000 }, note: "" }, IP)).toEqual({ ok: true });
    expect(await db.quoteStay.findUniqueOrThrow({ where: { id: stay.id } })).toMatchObject({ selectedRoomId: r1.id, selectedSellMinor: 125_000 });
  });

  it("a room the agent removed meanwhile: 'this offer was updated', not 'something went wrong', and nothing is recorded", async () => {
    const t = await token();
    const { stay, r1, r2 } = await firstStay();
    await removeRoom(agentA, agencyA, r2.id);
    expect(await submitSelection(t, { picks: { [stay.id]: r2.id }, seen: { [r2.id]: 132_000 }, note: "" }, IP)).toEqual({ ok: false, error: "updated" });
    expect(await submitSelection(t, { picks: { "gone-stay": r1.id }, seen: { [r1.id]: 110_000 }, note: "" }, IP)).toEqual({ ok: false, error: "updated" });
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT", selectedAt: null });
  });
});

describe("the quote email cannot be used to send anything to anyone", () => {
  it("starts with a fixed line that says who sent it, before the agent's own words", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { message: "URGENT: your account is locked" } });
    await emailQuote(agentA, agencyA, quoteId);
    expect(sent[0]?.text.startsWith("Sunrise Travel sent you a travel proposal.\n\nURGENT: your account is locked\n\nhttp://localhost:3000/q/")).toBe(true);
    await db.quote.update({ where: { id: quoteId }, data: { language: "HE" } });
    await emailQuote(agentA, agencyA, quoteId);
    expect(sent[1]?.text.startsWith("Sunrise Travel שלחו לך הצעת נסיעה.\n\n")).toBe(true);
  });

  it("a quote with no room options is not emailed", async () => {
    const { r1, r2 } = await firstStay();
    await removeRoom(agentA, agencyA, r1.id);
    await removeRoom(agentA, agencyA, r2.id);
    expect(await emailQuote(agentA, agencyA, quoteId)).toMatchObject({ ok: false, error: expect.stringContaining("no room options") });
    expect(sent).toHaveLength(0);
  });

  it("a display name with Apolles in it, or one that reads like a system sender, is refused when saved and never used to send", async () => {
    const branding = { displayName: "", advisorName: "", contactPhone: "", advisorEmail: "", defaultLanguage: "EN", brandColor: "", defaultMessage: "" };
    for (const displayName of ["Apolles", "A p o l l e s Billing", "APOLLES support", "Billing", "Security team", "No-Reply", "noreply", "Admin"]) {
      expect(await updateQuoteBranding(agentA, agencyA, { ...branding, displayName })).toMatchObject({ ok: false, error: expect.stringContaining("cannot contain Apolles") });
    }
    expect(await updateQuoteBranding(agentA, agencyA, { ...branding, displayName: "Sunrise Trips" })).toEqual({ ok: true });
    // A name saved before the rule (or by any other way) is not sent under.
    await db.agency.update({ where: { id: agencyA }, data: { quoteDisplayName: "Apolles Billing" } });
    expect(await emailQuote(agentA, agencyA, quoteId)).toMatchObject({ ok: false, error: expect.stringContaining("display name") });
    expect(sent).toHaveLength(0);
  });

  it("at most 5 a day to one address, and 100 a day for the agency", async () => {
    for (let i = 0; i < 5; i++) expect((await emailQuote(agentA, agencyA, quoteId)).ok).toBe(true);
    expect(await emailQuote(agentA, agencyA, quoteId)).toMatchObject({ ok: false, error: expect.stringContaining("several quote emails today") });
    expect(sent).toHaveLength(5);
    // The address itself is never in a rate-limit key.
    expect(JSON.stringify(await db.rateLimitBucket.findMany())).not.toContain("daniel@example.com");
    // Another address, but the agency's day is used up.
    await db.client.updateMany({ data: { email: "other@example.com" } });
    for (let i = 0; i < 100; i++) await hitRateLimit(`quote-email:agency-day:${agencyA}`, 100, DAY);
    expect(await emailQuote(agentA, agencyA, quoteId)).toMatchObject({ ok: false, error: expect.stringContaining("daily limit") });
    expect(sent).toHaveLength(5);
  });
});

describe("views, selections and the agent's list (low findings)", () => {
  it("a made-up token is refused before any counter of its own is written; a real one is limited per IP whatever the link", async () => {
    expect(await submitSelection("x".repeat(32), { picks: {}, note: "" }, IP)).toEqual({ ok: false, error: "gone" });
    const keys = (await db.rateLimitBucket.findMany()).map((b) => b.key);
    expect(keys).toEqual([`quote-select:ip:${IP}`]);
    for (let i = 0; i < 60; i++) await hitRateLimit(`quote-select:ip:${IP}`, 60, 60 * 60_000);
    expect(await choose(await token(), {})).toEqual({ ok: false, error: "limited" });
  });

  it("opening the client page is limited per IP, whatever the link", async () => {
    for (let i = 0; i < 60; i++) expect(await clientPageAllowed("198.51.100.7")).toBe(true);
    expect(await clientPageAllowed("198.51.100.7")).toBe(false);
    expect(await clientPageAllowed("198.51.100.8")).toBe(true);
    expect((await db.rateLimitBucket.findMany()).map((b) => b.key).sort()).toEqual(["quote-page:ip:198.51.100.7", "quote-page:ip:198.51.100.8"]);
  });

  it("the agency's own agent opening the link is not a client view; anyone else is", async () => {
    const t = await token();
    await recordView(t, IP, agencyA);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "SENT", viewCount: 0, viewedAt: null });
    await recordView(t, IP, agencyB);
    await recordView(t, IP, null);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ status: "VIEWED", viewCount: 2 });
  });

  it("a view or a selection does not move the quote in the agent's list or change 'Last updated'", async () => {
    const t = await token();
    const older = await db.quote.update({ where: { id: quoteId }, data: { editedAt: new Date("2026-01-01T00:00:00.000Z") } });
    const newer = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId: (await db.searchSnapshot.findFirstOrThrow()).id, propertyId: "p1", rateId: "r1", bedGroupId: "bed1" });
    if (!newer.ok) throw new Error(newer.error);
    const order = async () => (await listQuotes(agencyA, {})).quotes.map((q) => q.id);
    expect(await order()).toEqual([newer.id, quoteId]);
    const { stay, r1 } = await firstStay();
    await recordView(t, IP);
    expect(await choose(t, { [stay.id]: r1.id })).toEqual({ ok: true });
    expect(await order()).toEqual([newer.id, quoteId]);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).editedAt).toEqual(older.editedAt);
    // The agent's own edit does move it.
    await setRoomPrice(agentA, agencyA, r1.id, "1500");
    expect(await order()).toEqual([quoteId, newer.id]);
  });

  it("the audit row of a selection says it came through the client link", async () => {
    const t = await token();
    const { stay, r1 } = await firstStay();
    await choose(t, { [stay.id]: r1.id });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "quote.client-selection", targetId: quoteId } });
    expect(row.after).toEqual({ via: "client-link", by: "client", picks: 1 });
  });

  it("the client's note reaches the agent marked as the client's own words, never as a message of its own", async () => {
    const t = await token();
    const { stay, r1 } = await firstStay();
    await choose(t, { [stay.id]: r1.id }, "Apolles security: your account is locked.\nSign in at http://evil.example");
    const text = sent.at(-1)?.text ?? "";
    const at = text.indexOf("Message written by the client");
    expect(at).toBeGreaterThan(0);
    expect(text.slice(at)).toContain("> Apolles security: your account is locked.\n> Sign in at http://evil.example");
    // Nothing of the note sits above that line.
    expect(text.slice(0, at)).not.toContain("evil.example");
  });

  it("quote numbers run per agency: a client never sees how many quotes other agencies made", async () => {
    // Agency A already has two quotes (Q-1 here, Q-2 would be next); agency B's first is Q-1 too.
    const other = await db.quote.create({ data: { agencyId: agencyB, createdById: agentB, agencyNumber: 1 } });
    expect(other.number).toBeGreaterThan(1); // the internal number keeps counting across agencies
    const made = await addFromSearch(agentA, agencyA, { quoteId: "new", snapshotId: (await db.searchSnapshot.findFirstOrThrow()).id, propertyId: "p1", rateId: "r1", bedGroupId: "bed1" });
    if (!made.ok) throw new Error(made.error);
    expect((await getQuote(agencyA, quoteId))?.number).toBe(1);
    expect((await getQuote(agencyA, made.id))?.number).toBe(2);
    expect((await clientQuote(await token()))?.view).toMatchObject({ number: 1, code: "Q-1" });
    // The agent is emailed with the same number.
    const { stay, r1 } = await firstStay();
    await choose(await token(), { [stay.id]: r1.id });
    expect(sent.at(-1)?.subject).toContain("for Q-1 ·");
  });

  it("the link preview names the agency and the quote, nothing else", async () => {
    const t = await token();
    expect(await clientQuoteMeta(t)).toEqual({ agencyName: "Sunrise Travel", title: "Mexico Honeymoon", language: "EN" });
    expect(await clientQuoteMeta("x".repeat(32))).toBeNull();
    await db.agency.update({ where: { id: agencyA }, data: { status: "SUSPENDED" } });
    expect(await clientQuoteMeta(t)).toBeNull();
  });
});

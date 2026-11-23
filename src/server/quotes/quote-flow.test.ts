import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCompanion, createClient, deleteClient, findDuplicateClient, mergeClients } from "@/server/clients";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email/port";
import {
  addFromSearch,
  archiveQuote,
  clearSelection,
  closeQuote,
  countQuotesWithNewSelections,
  createQuote,
  deleteQuote,
  duplicateQuote,
  getQuote,
  listQuotes,
  markSelectionSeen,
  openQuotes,
  preSendChecks,
  quoteTabCounts,
  removeRoom,
  selectForClient,
  setRoomPrice,
  unarchiveQuote,
  updateQuoteSettings,
} from "@/server/quotes/quotes";
import { refreshStayPrices } from "@/server/quotes/refresh";
import { emailPreview, emailQuote, notifyRecipients, shareLink, submitSelection } from "@/server/quotes/sharing";
import { startSearch } from "@/server/search/search";
import { FakeSupplierAdapter } from "@/server/supplier/fake";
import type { Offer, PropertyOffers, SupplierAdapter } from "@/server/supplier/types";
import { resetTestDb } from "@/test/db";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  }),
}));

const NOW = new Date("2027-03-01T10:00:00.000Z");
const ctx = (agencyId = "A", userId = "u-A") => ({ agencyId, userId, supplierContext: {} });

// The fake supplier, with the totals changed by `delta` cents and the rates in `drop` left out.
function adapter(options: { delta?: number; drop?: string[]; nonRefundable?: boolean } = {}): SupplierAdapter {
  const real = new FakeSupplierAdapter();
  return {
    priceCheck: (r) => real.priceCheck(r),
    searchAvailability: async (q) => {
      const hotels: PropertyOffers[] = await real.searchAvailability(q);
      return hotels.map((h) => ({
        ...h,
        offers: h.offers
          .filter((o) => !(options.drop ?? []).includes(o.rateId))
          .map((o): Offer => ({
            ...o,
            ...(options.nonRefundable ? { refundable: false, cancelPenalties: [] } : {}),
            price: shift(o.price, options.delta ?? 0),
            roomPrices: o.roomPrices.map((p) => shift(p, options.delta ?? 0)),
          })),
      }));
    },
  };
}

// The room rate line and the total moved together, so the price still adds up.
function shift(price: Offer["price"], delta: number): Offer["price"] {
  return {
    ...price,
    total: { ...price.total, minor: price.total.minor + delta },
    lines: price.lines.map((line, i) => (i === 0 ? { ...line, amount: { ...line.amount, minor: line.amount.minor + delta } } : line)),
  };
}

let quoteId: string;

async function addRoom(target: string, checkin = "2027-04-10", checkout = "2027-04-12", index = 0): Promise<string> {
  const { snapshotId } = await startSearch(ctx(), { destinationId: "paris", checkin, checkout, rooms: [{ adults: 2, childAges: [] }] }, { adapter: adapter(), now: NOW });
  const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
  const offer = (hotel.offers as unknown as Offer[])[index]!;
  const added = await addFromSearch("u-A", "A", { quoteId: target, snapshotId, propertyId: "11", rateId: offer.rateId, bedGroupId: offer.bedGroups[0]!.id }, NOW);
  if (!added.ok) throw new Error(added.error);
  return added.id;
}

async function rooms() {
  return db.quoteRoom.findMany({ where: { hotel: { stay: { quoteId } } }, orderBy: { position: "asc" } });
}

async function stayId(): Promise<string> {
  return (await db.quoteStay.findFirstOrThrow({ where: { quoteId } })).id;
}

beforeEach(async () => {
  await resetTestDb();
  sent.length = 0;
  vi.mocked(sendEmail).mockClear();
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id.toLowerCase()}@test.local`, name: id, role: "AGENT", agencyId: id } });
  }
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel Lumiere", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
  quoteId = await addRoom("new");
  await addRoom(quoteId, "2027-04-10", "2027-04-12", 1);
});

describe("the agent selects for the client", () => {
  it("records the pick as the agent's, audited, and the quote is Selected; never for another agency", async () => {
    const [room] = await rooms();
    expect((await selectForClient("u-B", "B", room!.id, NOW)).ok).toBe(false);
    expect(await selectForClient("u-A", "A", room!.id, NOW)).toEqual({ ok: true, id: quoteId });
    const stay = await db.quoteStay.findFirstOrThrow({ where: { quoteId } });
    expect(stay).toMatchObject({ selectedRoomId: room!.id, selectedByAgent: true, selectedSellMinor: room!.netMinor, selectedCurrency: "USD" });
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SELECTED");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "quote.agent-selection" } });
    expect(log).toMatchObject({ actorUserId: "u-A", targetId: quoteId, after: { by: "agent", roomId: room!.id } });
  });

  it("clearing the only pick of a draft that was never sent makes it a draft again", async () => {
    const [room] = await rooms();
    await selectForClient("u-A", "A", room!.id, NOW);
    expect((await clearSelection("u-A", "A", await stayId())).ok).toBe(true);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true } })).toEqual({ status: "DRAFT" });
    expect(await db.quoteStay.findFirstOrThrow({ where: { quoteId } })).toMatchObject({ selectedRoomId: null, selectedByAgent: false });
  });

  it("refuses a destination whose check-in passed, and a closed quote", async () => {
    const [room] = await rooms();
    expect(await selectForClient("u-A", "A", room!.id, new Date("2027-04-10T08:00:00Z"))).toEqual({ ok: false, error: expect.stringContaining("has passed") });
    await db.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: NOW } });
    await closeQuote("u-A", "A", quoteId);
    expect((await selectForClient("u-A", "A", room!.id, NOW)).ok).toBe(false);
  });

  it("a client's own choice on the page replaces the agent's mark", async () => {
    const [room] = await rooms();
    await selectForClient("u-A", "A", room!.id, NOW);
    const shared = await shareLink("u-A", "A", quoteId, "link", { confirmNetPrice: true, now: NOW });
    const token = shared.ok ? shared.url.split("/q/")[1]! : "";
    const result = await submitSelection(token, { picks: { [await stayId()]: room!.id }, seen: { [room!.id]: room!.netMinor }, note: "" }, "1.2.3.4", NOW);
    expect(result).toEqual({ ok: true });
    expect(await db.quoteStay.findFirstOrThrow({ where: { quoteId } })).toMatchObject({ selectedRoomId: room!.id, selectedByAgent: false });
  });
});

describe("new selection badge and the agent's emails", () => {
  async function sharedToken(): Promise<string> {
    const shared = await shareLink("u-A", "A", quoteId, "link", { confirmNetPrice: true, now: NOW });
    if (!shared.ok) throw new Error(shared.error);
    return shared.url.split("/q/")[1]!;
  }

  it("a client message without a room is flagged as a message until the agent opens the quote", async () => {
    const token = await sharedToken();
    expect(await submitSelection(token, { picks: {}, note: "Can we have a sea view?" }, "1.2.3.4", NOW)).toEqual({ ok: true });
    expect(await countQuotesWithNewSelections("A")).toBe(1);
    expect(await countQuotesWithNewSelections("B")).toBe(0);
    expect((await listQuotes("A", {})).quotes[0]).toMatchObject({ id: quoteId, news: "message" });
    expect(sent.map((m) => m.subject)).toEqual([expect.stringContaining("sent a message")]);
    await markSelectionSeen("B", quoteId); // another agency's open changes nothing
    expect(await countQuotesWithNewSelections("A")).toBe(1);
    await markSelectionSeen("A", quoteId);
    expect(await countQuotesWithNewSelections("A")).toBe(0);
    expect((await listQuotes("A", {})).quotes[0]?.news).toBeNull();
  });

  it("the selection email goes to the quote's creator and the agency's advisor email, once each", async () => {
    await db.agency.update({ where: { id: "A" }, data: { quoteAdvisorEmail: "desk@agency.example" } });
    const token = await sharedToken();
    const [room] = await rooms();
    await submitSelection(token, { picks: { [await stayId()]: room!.id }, seen: { [room!.id]: room!.netMinor }, note: "" }, "1.2.3.4", NOW);
    expect(sent.map((m) => m.to).sort()).toEqual(["a@test.local", "desk@agency.example"]);
    expect((await listQuotes("A", {})).quotes[0]?.news).toBe("selection");
    expect(notifyRecipients("Same@Agency.example", "same@agency.example")).toEqual(["Same@Agency.example"]);
    expect(notifyRecipients("a@x.example", null)).toEqual(["a@x.example"]);
  });
});

describe("refresh prices", () => {
  it("updates the net and terms in place, keeps the typed price and the client's pick, and flags the change", async () => {
    const [first, second] = await rooms();
    await setRoomPrice("u-A", "A", second!.id, "999.00", { confirmBelowNet: true });
    await selectForClient("u-A", "A", first!.id, NOW);
    const later = new Date(NOW.getTime() + 60 * 60_000);
    const result = await refreshStayPrices(ctx(), await stayId(), { adapter: adapter({ delta: 1_500 }), now: later });
    expect(result).toMatchObject({ ok: true, summary: { checked: 2, up: 2, down: 0, gone: 0 } });
    const [a, b] = await rooms();
    expect(a).toMatchObject({ netMinor: first!.netMinor + 1_500, previousNetMinor: first!.netMinor, pricedAt: later, unavailable: false });
    expect(b).toMatchObject({ netMinor: second!.netMinor + 1_500, sellMinor: 99_900 });
    // The client's pick stays, with the price it was chosen at.
    expect(await db.quoteStay.findFirstOrThrow({ where: { quoteId } })).toMatchObject({ selectedRoomId: first!.id, selectedSellMinor: first!.netMinor });
  });

  it("flags a room that is gone and worse cancellation terms; never another agency's quote", async () => {
    const [first, second] = await rooms();
    expect(await refreshStayPrices(ctx("B", "u-B"), await stayId(), { adapter: adapter(), now: NOW })).toEqual({ ok: false, error: "This quote was not found." });
    const result = await refreshStayPrices(ctx(), await stayId(), { adapter: adapter({ drop: [second!.rateId], nonRefundable: true }), now: NOW });
    expect(result).toMatchObject({ ok: true, summary: { gone: 1 } });
    const [a, b] = await rooms();
    expect(b).toMatchObject({ unavailable: true, netMinor: second!.netMinor });
    if (first!.refundable && first!.freeCancelUntil) expect(a).toMatchObject({ cancelWorse: true, refundable: false, freeCancelUntil: null, clientCancelUntil: null });
  });

  it("refuses a booked destination's quote and a closed quote", async () => {
    await db.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: NOW } });
    await closeQuote("u-A", "A", quoteId);
    expect((await refreshStayPrices(ctx(), await stayId(), { adapter: adapter(), now: NOW })).ok).toBe(false);
  });
});

describe("delete, archive, duplicate", () => {
  it("deletes a draft only, and never another agency's", async () => {
    expect((await deleteQuote("u-B", "B", quoteId)).ok).toBe(false);
    await db.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: NOW } });
    expect(await deleteQuote("u-A", "A", quoteId)).toEqual({ ok: false, error: expect.stringContaining("Archive") });
    await db.quote.update({ where: { id: quoteId }, data: { status: "DRAFT", sentAt: null } });
    expect((await deleteQuote("u-A", "A", quoteId)).ok).toBe(true);
    expect(await db.quote.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "quote.delete", targetId: quoteId } })).toBe(1);
  });

  it("archive hides the quote from the list and the picker and closes it; unarchive brings it back", async () => {
    expect((await archiveQuote("u-A", "A", quoteId, NOW)).ok).toBe(false); // a draft
    await db.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: NOW } });
    expect((await archiveQuote("u-B", "B", quoteId, NOW)).ok).toBe(false);
    expect((await archiveQuote("u-A", "A", quoteId, NOW)).ok).toBe(true);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).toMatchObject({ archivedAt: NOW, closedAt: NOW });
    expect((await listQuotes("A", {})).quotes).toHaveLength(0);
    expect((await listQuotes("A", { tab: "archived" })).quotes.map((q) => q.id)).toEqual([quoteId]);
    expect(await openQuotes("A")).toEqual([]);
    expect(await quoteTabCounts("A")).toMatchObject({ all: 0, sent: 0, archived: 1 });
    expect((await unarchiveQuote("u-A", "A", quoteId)).ok).toBe(true);
    expect((await listQuotes("A", {})).quotes.map((q) => q.id)).toEqual([quoteId]);
  });

  it("duplicate copies destinations, hotels, rooms and settings into a new draft, prices marked for refresh", async () => {
    const client = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "d@example.com", nationality: "IL", notes: "" });
    await updateQuoteSettings("u-A", "A", quoteId, { title: "Paris", clientId: client.ok ? client.id : "", language: "HE", message: "Hi Daniel", showCancellation: false, markupType: "PERCENT", markupValue: "12", adults: "2", childAges: "" });
    expect((await duplicateQuote("u-B", "B", quoteId)).ok).toBe(false);
    const copy = await duplicateQuote("u-A", "A", quoteId);
    if (!copy.ok) throw new Error(copy.error);
    const q = await getQuote("A", copy.id);
    expect(q).toMatchObject({ title: "Paris (copy)", status: "DRAFT", client: null, message: "", language: "HE", showCancellation: false, markupValue: 1200, shareToken: null });
    expect(q!.number).toBe(2);
    expect(q!.stays).toHaveLength(1);
    expect(q!.stays[0]!.hotels[0]!.rooms.map((r) => r.needsRefresh)).toEqual([true, true]);
    expect(preSendChecks(q!, NOW).some((t) => t.includes("Refresh the prices"))).toBe(true);
  });
});

describe("new quotes and the Add to quote picker", () => {
  it("+ New quote opens the agent's own empty draft again, and empty drafts untouched for a day go", async () => {
    const first = await createQuote("u-A", "A", {}, NOW);
    const again = await createQuote("u-A", "A", {}, NOW);
    expect(again).toEqual(first);
    expect(await db.quote.count({ where: { agencyId: "A" } })).toBe(2);
    const dayLater = new Date(NOW.getTime() + 25 * 60 * 60_000);
    await db.quote.update({ where: { id: first.ok ? first.id : "" }, data: { editedAt: NOW } });
    const fresh = await createQuote("u-A", "A", {}, dayLater);
    expect(fresh.ok && fresh.id !== (first.ok ? first.id : "")).toBe(true);
    // The quote with rooms stays; the old empty draft is gone.
    expect((await db.quote.findMany({ where: { agencyId: "A" }, select: { id: true } })).map((q) => q.id).sort()).toEqual([quoteId, fresh.ok ? fresh.id : ""].sort());
  });

  it("leaves empty drafts out, names the client and dates, and the quote used last comes first", async () => {
    const empty = await createQuote("u-A", "A", {}, NOW);
    const list = await openQuotes("A");
    expect(list.map((q) => q.id)).toEqual([quoteId]);
    expect(list[0]?.label).toBe("Q-1 · Untitled quote · No client · Apr 10 to Apr 12");
    // The quote the agent came from is offered even when empty.
    expect((await openQuotes("A", empty.ok ? empty.id : "")).map((q) => q.id)).toContain(empty.ok ? empty.id : "");
  });
});

describe("quote list search, counts and pages", () => {
  it("finds a quote by hotel name and by the client's email or phone; filters by client", async () => {
    const client = await createClient("u-A", "A", { firstName: "Maya", lastName: "Cohen", phone: "050-555 0142", email: "Maya@Example.com", nationality: "IL", notes: "" });
    const clientId = client.ok ? client.id : "";
    await updateQuoteSettings("u-A", "A", quoteId, { title: "", clientId, language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" });
    for (const q of ["lumiere", "maya@example", "555 0142", "0505550142"]) expect((await listQuotes("A", { q })).quotes.map((x) => x.id)).toEqual([quoteId]);
    expect((await listQuotes("A", { q: "nothing here" })).quotes).toHaveLength(0);
    expect((await listQuotes("B", { q: "lumiere" })).quotes).toHaveLength(0);
    expect((await listQuotes("A", { clientId })).quotes).toHaveLength(1);
    expect((await listQuotes("A", { clientId: "other" })).quotes).toHaveLength(0);
    expect(await quoteTabCounts("A", { q: "lumiere" })).toMatchObject({ all: 1, draft: 1, sent: 0 });
  });

  it("Load more shows more pages at once", async () => {
    for (let i = 0; i < 21; i++) await db.quote.create({ data: { agencyId: "A", createdById: "u-A", title: `T${i}`, agencyNumber: 100 + i } });
    const one = await listQuotes("A", {});
    expect(one.quotes).toHaveLength(20);
    expect(one.nextCursor).not.toBeNull();
    const two = await listQuotes("A", { pages: 2 });
    expect(two.quotes).toHaveLength(22);
    expect(two.nextCursor).toBeNull();
  });
});

describe("before sending", () => {
  it("lists what to check: client, profit, dates passed, free cancellation passed", async () => {
    const q = await getQuote("A", quoteId);
    const checks = preSendChecks(q!, NOW);
    expect(checks).toContain("No client is chosen. Pick or add a client in the Client card.");
    expect(checks.filter((t) => t.includes("no profit"))).toHaveLength(2); // 0% markup
    const after = preSendChecks(q!, new Date("2027-04-11T00:00:00Z"));
    expect(after.some((t) => t.includes("check-in date (Apr 10, 2027) has passed"))).toBe(true);
  });

  it("the email preview is what Send by email sends, and sends nothing itself", async () => {
    const client = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "d@example.com", nationality: "IL", notes: "" });
    await updateQuoteSettings("u-A", "A", quoteId, { title: "Paris", clientId: client.ok ? client.id : "", language: "EN", message: "", showCancellation: true, markupType: "PERCENT", markupValue: "10", adults: "2", childAges: "" });
    expect((await emailPreview("u-B", "B", quoteId)).ok).toBe(false);
    const preview = await emailPreview("u-A", "A", quoteId);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview).toMatchObject({ to: "d@example.com", subject: "Paris · Agency A" });
    expect(sent).toHaveLength(0);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("DRAFT");
    expect((await emailQuote("u-A", "A", quoteId)).ok).toBe(true);
    expect(sent[0]).toMatchObject({ to: "d@example.com", subject: preview.subject, text: preview.text });
  });
});

describe("clients: duplicates, delete, merge", () => {
  it("finds a duplicate by email (any case) or the same phone digits, in the agency only", async () => {
    const made = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "daniel@example.com", nationality: "IL", notes: "" });
    const id = made.ok ? made.id : "";
    expect(await findDuplicateClient("A", { email: "DANIEL@example.com" })).toEqual({ id, firstName: "Daniel", lastName: "Levy", matchedOn: "email" });
    expect(await findDuplicateClient("A", { phone: "00972 50-123-4567" })).toMatchObject({ id, matchedOn: "phone" });
    expect(await findDuplicateClient("A", { email: "daniel@example.com" }, id)).toBeNull();
    expect(await findDuplicateClient("B", { email: "daniel@example.com" })).toBeNull();
    expect(await findDuplicateClient("A", { email: "", phone: "12" })).toBeNull();
  });

  it("delete keeps the client's quotes working with no client; never another agency's client", async () => {
    const made = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "", nationality: "IL", notes: "" });
    const id = made.ok ? made.id : "";
    await db.quote.update({ where: { id: quoteId }, data: { clientId: id } });
    expect((await deleteClient("u-B", "B", id)).ok).toBe(false);
    expect((await deleteClient("u-A", "A", id)).ok).toBe(true);
    expect(await getQuote("A", quoteId)).toMatchObject({ client: null });
    expect(await db.client.count()).toBe(0);
  });

  it("merge moves the quotes and companions to the kept client and deletes the other", async () => {
    const keep = await createClient("u-A", "A", { firstName: "Daniel", lastName: "Levy", phone: "+972 50 123 4567", email: "", nationality: "IL", notes: "" });
    const other = await createClient("u-A", "A", { firstName: "Dani", lastName: "Levy", phone: "050 123 4567", email: "dani@example.com", nationality: "IL", notes: "" });
    const keepId = keep.ok ? keep.id : "";
    const otherId = other.ok ? other.id : "";
    await addCompanion("u-A", "A", keepId, { firstName: "Maya", lastName: "Levy", relation: "Spouse", childAge: "" });
    await addCompanion("u-A", "A", otherId, { firstName: "Noa", lastName: "Levy", relation: "Daughter", childAge: "7" });
    await db.quote.update({ where: { id: quoteId }, data: { clientId: otherId } });
    expect((await mergeClients("u-B", "B", keepId, otherId)).ok).toBe(false);
    expect((await mergeClients("u-A", "A", keepId, keepId)).ok).toBe(false);
    expect(await mergeClients("u-A", "A", keepId, otherId)).toEqual({ ok: true, id: keepId });
    expect((await getQuote("A", quoteId))?.client?.id).toBe(keepId);
    const kept = await db.client.findUniqueOrThrow({ where: { id: keepId }, include: { companions: { orderBy: { position: "asc" } } } });
    expect(kept.email).toBe("dani@example.com");
    expect(kept.companions.map((c) => [c.firstName, c.position])).toEqual([["Maya", 0], ["Noa", 1]]);
    expect(await db.client.count()).toBe(1);
  });
});

it("a room removed after the agent picked it leaves a never-sent quote as a draft", async () => {
  const [room] = await rooms();
  await selectForClient("u-A", "A", room!.id, NOW);
  await removeRoom("u-A", "A", room!.id);
  expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("DRAFT");
});

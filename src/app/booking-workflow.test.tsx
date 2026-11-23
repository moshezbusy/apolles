import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { db } from "@/server/db";
import { startSearch } from "@/server/search/search";
import type { Offer } from "@/server/supplier/types";
import { credit, getBalance } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
  usePathname: vi.fn(() => "/book/new"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "TestBrowser/1.0" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

function signInAs(agencyId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId: `u-${agencyId}`, agencyId });
}
function iso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
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

async function seed(balance = 500_000) {
  for (const id of ["A", "B"]) {
    await db.agency.create({ data: { id, name: `Agency ${id}`, country: "IL", bankReference: `APL-${id}` } });
    await db.user.create({ data: { id: `u-${id}`, email: `${id}@t.local`, name: id, role: "AGENT", agencyId: id } });
  }
  if (balance > 0) await credit({ agencyId: "A", type: "TOPUP_BANK", amountCents: balance, reason: "test", idempotencyKey: "seed" });
  await db.destination.create({ data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" } });
  await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
  await db.destinationProperty.create({ data: { destinationId: "paris", propertyId: "11" } });
  const { snapshotId } = await startSearch({ agencyId: "A", userId: "u-A", supplierContext: {} }, { destinationId: "paris", checkin: iso(30), checkout: iso(32), rooms: [{ adults: 2, childAges: [6] }] });
  const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
  return { snapshotId, offers: hotel.offers as unknown as Offer[] };
}

const guestFields = {
  r0_given_0: "Dana",
  r0_family_0: "Levi",
  r0_given_1: "Avi",
  r0_family_1: "Levi",
  r0_given_2: "Noa",
  r0_family_2: "Levi",
  leadEmail: "dana@example.com",
  phoneCountry: "972",
  phoneNumber: "50-123-4567",
};

async function draftFor(snapshotId: string, offer: Offer): Promise<string> {
  const { createDraftAction } = await import("./(agent)/book/actions");
  const to = await redirectOf(createDraftAction(null, form({ s: snapshotId, p: "11", r: offer.rateId, b: offer.bedGroups[0]!.id, ...guestFields })));
  return to.replace("/book/", "");
}

// Wave 2 of the scan fixes (screens 10 to 13): the guest form says which field is wrong, names
// are in Latin letters, the draft can be edited in place, an old price check offers to check
// again, a draft the agent could not pay is easy to find, and the bookings list has filters.
describe("booking workflow fixes", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("guest form: each wrong field gets its own message; names must be Latin letters; nothing is saved", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const { createDraftAction } = await import("./(agent)/book/actions");
    const rate = { s: snapshotId, p: "11", r: offers[0]!.rateId, b: offers[0]!.bedGroups[0]!.id };
    const state = await createDraftAction(null, form({ ...rate, ...guestFields, r0_given_1: "אבי", r0_family_2: "", leadEmail: "dana@", phoneNumber: "12" }));
    expect(state).toMatchObject({
      status: "error",
      message: "4 fields are missing or wrong. Check the fields marked in red.",
      fields: {
        r0_given_1: "Use Latin letters (A to Z), as on the passport.",
        r0_family_2: "Enter the family name.",
        leadEmail: "Enter a valid email, like name@example.com.",
        phoneNumber: "Enter the phone number: 4 to 14 digits.",
      },
      values: { r0_given_0: "Dana" },
    });
    expect(await db.booking.count()).toBe(0);
    // Accents are Latin letters: accepted.
    expect(await redirectOf(createDraftAction(null, form({ ...rate, ...guestFields, r0_given_0: "Dána", r0_family_0: "O'Brien-Lévy" })))).toMatch(/^\/book\//);
  });

  it("the server refuses a non-Latin name too, whatever the form sent", async () => {
    const { createDraft, BookingInputInvalid } = await import("@/server/booking/service");
    const { snapshotId, offers } = await seed();
    const input = {
      snapshotId, propertyId: "11", rateId: offers[0]!.rateId, bedGroupId: offers[0]!.bedGroups[0]!.id,
      rooms: [{ guests: [{ givenName: "Дана", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }] }],
      leadEmail: "dana@example.com", leadPhone: { countryCode: "972", number: "501234567" },
    };
    const error = await createDraft({ agencyId: "A", userId: "u-A", supplierContext: {} }, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BookingInputInvalid);
    expect((error as InstanceType<typeof BookingInputInvalid>).fields).toEqual(["rooms.0.guests.0.givenName"]);
  });

  it("guest page: a way back to the room options of the same search", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const { default: GuestPage } = await import("./(agent)/book/new/page");
    const offer = offers[1]!;
    const html = renderToStaticMarkup(await GuestPage({ searchParams: Promise.resolve({ s: snapshotId, p: "11", r: offer.rateId, b: offer.bedGroups[0]!.id }) }));
    expect(html).toContain(`href="/search/${snapshotId}/hotels/11"`);
    expect(html).toContain(">Back to room options<");
  });

  it("review: the lead guest's contact, and Edit guest details changes the same draft (no second one)", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    const review = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    expect(review).toContain("dana@example.com · +972 501234567");
    expect(review).toContain(`href="/book/${id}/edit"`);

    const { default: EditPage } = await import("./(agent)/book/[id]/edit/page");
    const edit = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id }) }));
    expect(edit).toContain('value="Noa"');
    expect(edit).toContain('value="501234567"');
    expect(edit).not.toContain('name="saveClient"');

    const { updateDraftAction } = await import("./(agent)/book/actions");
    const changed = { ...guestFields, r0_given_0: "Dina", leadEmail: "dina@example.com", requests: "HIGH_FLOOR", requestText: "Quiet room" };
    expect(await redirectOf(updateDraftAction(null, form({ bookingId: id, ...changed })))).toBe(`/book/${id}`);
    expect(await db.booking.count()).toBe(1);
    const after = await db.booking.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: "DRAFT", leadGivenName: "Dina", leadEmail: "dina@example.com", specialRequest: "High floor. Quiet room" });
    expect((await db.bookingRoom.findFirstOrThrow({ where: { bookingId: id } })).givenName).toBe("Dina");
    expect(await db.bookingEvent.count({ where: { bookingId: id, reason: "Guest details changed" } })).toBe(1);
    // The edit page reads the requests back.
    const again = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id }) }));
    expect(again).toContain('value="Quiet room"');

    // A wrong field on edit: marked, and nothing changes.
    expect(await updateDraftAction(null, form({ bookingId: id, ...changed, r0_family_0: "" }))).toMatchObject({ fields: { r0_family_0: "Enter the family name." } });
    // Another agency cannot edit it.
    signInAs("B");
    await expect(updateDraftAction(null, form({ bookingId: id, ...changed, r0_given_0: "Eve" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).leadGivenName).toBe("Dina");
  });

  it("a booked draft cannot be edited: the edit page and the action go to the booking", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
    const { default: EditPage } = await import("./(agent)/book/[id]/edit/page");
    await expect(EditPage({ params: Promise.resolve({ id }) })).rejects.toThrow(`NEXT_REDIRECT:/bookings/${id}`);
    const { updateDraftAction } = await import("./(agent)/book/actions");
    expect(await redirectOf(updateDraftAction(null, form({ bookingId: id, ...guestFields, r0_given_0: "Eve" })))).toBe(`/bookings/${id}`);
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).leadGivenName).toBe("Dana");
  });

  it("a price check older than 10 minutes: Book offers to check the price again, and nothing is held", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    await db.booking.update({ where: { id }, data: { priceCheckedAt: new Date(Date.now() - 11 * 60_000) } });
    const booking = await db.booking.findUniqueOrThrow({ where: { id } });
    const { bookAction } = await import("./(agent)/book/actions");
    expect(await bookAction(null, form({ bookingId: id, expectedTotal: String(booking.totalMinor), acceptedTerms: "on" }))).toEqual({
      status: "error",
      message: "The price was checked more than 10 minutes ago. Check the price again, then book.",
      recheck: true,
    });
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    expect((await getBalance("A")).heldCents).toBe(0);
  });

  it("not enough balance: the amount missing, and the draft stays findable under Not finished", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed(1_000);
    const id = await draftFor(snapshotId, offers[0]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    expect(html).toMatch(/Your balance is not enough for this booking\. Missing: USD [\d,]+\.\d{2}/);
    expect(html).toContain('href="/bookings?tab=not_finished"');
    const booking = await db.booking.findUniqueOrThrow({ where: { id } });
    const { bookAction } = await import("./(agent)/book/actions");
    const state = await bookAction(null, form({ bookingId: id, expectedTotal: String(booking.totalMinor), acceptedTerms: "on" }));
    expect(state?.message).toMatch(/Missing: USD [\d,]+\.\d{2}\. Top up your balance, then book\. This booking is kept under Bookings, Not finished, for 7 days\./);

    const { default: ListPage } = await import("./(agent)/bookings/page");
    const list = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ tab: "not_finished" }) }));
    expect(list).toContain(booking.reference);
    expect(list).toContain(`href="/book/${id}"`);
    expect(list).toContain(">Finish booking<");
    expect(renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }))).not.toContain(booking.reference);
  });

  it("review: the agency's default markup is offered as the selling price, not saved until the agent saves it", async () => {
    signInAs("A");
    await seed();
    await db.agency.update({ where: { id: "A" }, data: { defaultMarkupType: "PERCENT", defaultMarkupValue: 1_250 } });
    const { snapshotId, offers } = await (async () => {
      const hotel = await db.searchHotel.findFirstOrThrow({});
      return { snapshotId: hotel.snapshotId, offers: hotel.offers as unknown as Offer[] };
    })();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain('value="12.5"');
    expect(html).toContain("Your default markup from Agency settings.");
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).sellMarkupType).toBeNull();
  });

  it("bookings list (13): New booking, a count, date filters kept in every link, Load more adds rows below", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
    const { default: ListPage } = await import("./(agent)/bookings/page");
    const today = new Date().toISOString().slice(0, 10);
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ bookedFrom: today, checkinFrom: "2000-01-01" }) }));
    expect(html).toContain('href="/search"');
    expect(html).toContain("+ New booking");
    expect(html).toContain("1 booking<");
    expect(html).toContain(`href="/bookings?tab=failed&amp;bookedFrom=${today}&amp;checkinFrom=2000-01-01"`);
    expect(html).toContain(">Not confirmed<");
    expect(html).toContain(">Clear filters<");
    expect(html).toContain(`href="/bookings/export?tab=all&amp;bookedFrom=${today}&amp;checkinFrom=2000-01-01"`);
    expect(html).toMatch(/rounded-full[^"]*bg-brand-soft text-brand"><span aria-hidden="true"[^>]*><\/span>Confirmed/);
    const none = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({ bookedTo: "2000-01-01" }) }));
    expect(none).toContain("No bookings match these filters.");
    expect(none).toContain("0 bookings<");
  });

  it("booking page (12): booked on, the client and the quote it came from, Copy details, free cancellation on top, the last email to the client", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    const booking = await db.booking.findUniqueOrThrow({ where: { id } });
    const { bookAction } = await import("./(agent)/book/actions");
    await redirectOf(bookAction(null, form({ bookingId: id, expectedTotal: String(booking.totalMinor), acceptedTerms: "on" })));
    // A client of the agency with the lead guest's email; one of another agency too.
    const client = await db.client.create({ data: { agencyId: "A", firstName: "Dana", lastName: "Levi", email: "dana@example.com", phone: "+972 50 123 4567", phoneDigits: "972501234567", nationality: "IL" } });
    await db.client.create({ data: { agencyId: "B", firstName: "Other", lastName: "Agency", email: "dana@example.com", phone: "+972 50 123 4567", phoneDigits: "972501234567", nationality: "IL" } });
    const start = "2099-01-01T00:00:00.000+02:00";
    await db.booking.update({ where: { id }, data: { refundable: true, nonrefundableDateRanges: [], cancelPenalties: [{ start, end: "2099-01-02T00:00:00.000+02:00", amount: null, nights: 1, percent: null }], freeCancelEndsAt: new Date("2098-12-31T21:50:00Z") } });
    await db.auditLog.create({ data: { actorUserId: "u-A", action: "booking.email-client", targetType: "Booking", targetId: id, after: { language: "EN", to: "no•••@example.com" }, createdAt: new Date("2026-11-20T09:05:00Z") } });

    const { default: SummaryPage } = await import("./(agent)/bookings/[id]/page");
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/Booked on [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{2}:\d{2} UTC/);
    expect(html).toContain(`href="/clients?id=${client.id}"`);
    expect(html).toContain("Free cancellation until Thu, Jan 1, 2099, 00:00 hotel time. Cancelling before then costs nothing.");
    expect(html).toContain(">Copy details<");
    expect(html).toContain("Last sent on Nov 20, 2026 at 09:05 UTC to no•••@example.com");
    // The copied text (in the button's props) names the booking and the guests, never a price.
    expect(html).not.toContain("From quote");
  });

  it("booking page: a booking from a quote links back to it", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const quote = await db.quote.create({ data: { agencyId: "A", createdById: "u-A", agencyNumber: 7, title: "Paris" } });
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED", quoteId: quote.id } });
    const { default: SummaryPage } = await import("./(agent)/bookings/[id]/page");
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/quotes/${quote.id}"`);
    expect(html).toContain("Q-7");
  });

  it("Request a change: sent for a confirmed booking and listed; clear messages when refused", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { changeRequestAction } = await import("./(agent)/bookings/[id]/actions");
    // A draft is not a booking yet.
    expect(await changeRequestAction(null, form({ bookingId: id, text: "Change the name" }))).toMatchObject({ status: "error", message: expect.stringContaining("only while the booking is confirmed") });
    await db.booking.update({ where: { id }, data: { status: "CONFIRMED" } });
    expect(await changeRequestAction(null, form({ bookingId: id, text: "   " }))).toMatchObject({ status: "error", message: "Write what should change, in up to 2,000 characters." });
    expect(await changeRequestAction(null, form({ bookingId: id, text: "Second guest is Avi Cohen" }))).toMatchObject({ status: "success" });
    const { default: SummaryPage } = await import("./(agent)/bookings/[id]/page");
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Request a change");
    expect(html).toContain("Second guest is Avi Cohen");
    expect(html).toContain(">Send change request<");
    signInAs("B");
    expect(await changeRequestAction(null, form({ bookingId: id, text: "x" }))).toMatchObject({ message: "This booking was not found. Open it again from Bookings." });
    expect(await db.changeRequest.count()).toBe(1);
  });
});

vi.setConfig({ testTimeout: 30_000 });

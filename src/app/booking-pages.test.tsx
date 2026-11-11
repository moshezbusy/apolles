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
  const { snapshotId } = await startSearch({ agencyId: "A", userId: "u-A", supplierContext: {} }, { destinationId: "paris", checkin: iso(30), checkout: iso(32), adults: 2, childAges: [6] });
  const hotel = await db.searchHotel.findFirstOrThrow({ where: { snapshotId } });
  return { snapshotId, offers: hotel.offers as unknown as Offer[] };
}

const guestFields = {
  given_0: "Dana",
  family_0: "Levi",
  given_1: "Avi",
  family_1: "Levi",
  given_2: "Noa",
  family_2: "Levi",
  leadEmail: "dana@example.com",
  phoneCountry: "972",
  phoneNumber: "50-123-4567",
};

async function draftFor(snapshotId: string, offer: Offer): Promise<string> {
  const { createDraftAction } = await import("./(agent)/book/actions");
  const to = await redirectOf(createDraftAction(null, form({ s: snapshotId, p: "11", r: offer.rateId, b: offer.bedGroups[0]!.id, ...guestFields })));
  return to.replace("/book/", "");
}

describe("booking screens", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("SUPPLIER_MODE", "fake");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("guest details (10): a field for every guest, children with their age, no price from the browser", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const { default: GuestPage } = await import("./(agent)/book/new/page");
    const offer = offers[1]!;
    const html = renderToStaticMarkup(await GuestPage({ searchParams: Promise.resolve({ s: snapshotId, p: "11", r: offer.rateId, b: offer.bedGroups[1]!.id }) }));
    expect(html).toContain("Guest details");
    expect(html).toContain('name="given_2"');
    expect(html).toContain("Child 1 (age 6)");
    expect(html).toContain("2 Twin Beds");
    expect(html).toContain("Bed type is a request and not guaranteed");
    expect(html).not.toMatch(/Choose from clients/i);
    expect(html).not.toContain("fake-11");
  });

  it("guest details: another agency's search, or an expired one, asks to search again", async () => {
    signInAs("B");
    const { snapshotId, offers } = await seed();
    const { default: GuestPage } = await import("./(agent)/book/new/page");
    const html = renderToStaticMarkup(await GuestPage({ searchParams: Promise.resolve({ s: snapshotId, p: "11", r: offers[0]!.rateId, b: offers[0]!.bedGroups[0]!.id }) }));
    expect(html).toMatch(/expired/i);
  });

  it("the draft action keeps what was typed after an error", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const { createDraftAction } = await import("./(agent)/book/actions");
    const state = await createDraftAction(null, form({ s: snapshotId, p: "11", r: offers[0]!.rateId, b: offers[0]!.bedGroups[0]!.id, ...guestFields, given_2: "" }));
    expect(state).toMatchObject({ status: "error", values: { given_0: "Dana" } });
  });

  it("review & book (11): price checked, breakdown, policies, guests with ages, balance and the terms box", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[2]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    expect(html).toContain("Review and book");
    expect(html).toContain("Taxes and fees");
    expect(html).toContain("Paid at the property");
    expect(html).toContain("Dana Levi");
    expect(html).toContain("Noa Levi (child, age 6)");
    expect(html).toContain("Supplier Terms &amp; Conditions");
    expect(html).toContain('name="acceptedTerms"');
    expect(html).toContain("Book and issue voucher");
    expect(html).toContain("Available balance");
    expect(html).not.toContain("fakebk-");
  });

  it("not enough balance: the page shows how much is missing and how to top up", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed(1_000);
    const id = await draftFor(snapshotId, offers[0]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    expect(html).toMatch(/Missing: USD [\d,]+\.\d{2}/);
    expect(html).toContain('href="/balance"');
  });

  it("book → confirmed summary (12) → cancel, with the wallet right at each step", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) })); // runs the price check
    const booking = await db.booking.findUniqueOrThrow({ where: { id } });
    const { bookAction } = await import("./(agent)/book/actions");
    expect(await redirectOf(bookAction(null, form({ bookingId: id, expectedTotal: String(booking.totalMinor), acceptedTerms: "on" })))).toBe(`/bookings/${id}`);
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000 - booking.totalMinor, heldCents: 0 });

    const { default: SummaryPage } = await import("./(agent)/bookings/[id]/page");
    const html = renderToStaticMarkup(await SummaryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    expect(html).toContain(booking.reference);
    expect(html).toContain("Confirmed");
    expect(html).toContain("Hotel confirmation");
    expect(html).toContain("Cancel booking");
    expect(html).toContain(`href="/bookings/${id}/voucher"`);
    const { GET: voucher } = await import("./(agent)/bookings/[id]/voucher/route");
    const pdf = await voucher(new Request(`http://localhost/bookings/${id}/voucher`), { params: Promise.resolve({ id }) });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const { cancelAction } = await import("./(agent)/bookings/[id]/actions");
    expect(await redirectOf(cancelAction(form({ bookingId: id, expectedCharge: "0" })))).toBe(`/bookings/${id}?notice=cancelled`);
    expect((await db.booking.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    expect(await getBalance("A")).toEqual({ balanceCents: 500_000, heldCents: 0 });
  });

  it("another agency's booking id gives not found everywhere (no IDOR)", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    signInAs("B");
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    await expect(ReviewPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
    const { default: SummaryPage } = await import("./(agent)/bookings/[id]/page");
    await expect(SummaryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    const { bookAction } = await import("./(agent)/book/actions");
    await expect(bookAction(null, form({ bookingId: id, expectedTotal: "1", acceptedTerms: "on" }))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("bookings list (13): tabs, search box, the agency's bookings only, and a CSV link", async () => {
    signInAs("A");
    const { snapshotId, offers } = await seed();
    const id = await draftFor(snapshotId, offers[1]!);
    const { default: ReviewPage } = await import("./(agent)/book/[id]/page");
    renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id }) }));
    const booking = await db.booking.findUniqueOrThrow({ where: { id } });
    const { bookAction } = await import("./(agent)/book/actions");
    await redirectOf(bookAction(null, form({ bookingId: id, expectedTotal: String(booking.totalMinor), acceptedTerms: "on" })));

    const { default: ListPage } = await import("./(agent)/bookings/page");
    const html = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(booking.reference);
    for (const tab of ["All", "Upcoming", "Pending", "Cancelled"]) expect(html).toContain(`>${tab}<`);
    expect(html).toContain('href="/bookings/export?tab=all"');
    signInAs("B");
    const other = renderToStaticMarkup(await ListPage({ searchParams: Promise.resolve({}) }));
    expect(other).not.toContain(booking.reference);

    signInAs("A");
    const { GET } = await import("./(agent)/bookings/export/route");
    const response = await GET(new Request("http://localhost/bookings/export?tab=all"));
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="apolles-bookings-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(await response.text()).toContain(booking.reference);
  });
});

vi.setConfig({ testTimeout: 30_000 });

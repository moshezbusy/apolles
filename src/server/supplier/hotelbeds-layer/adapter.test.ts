import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { SupplierAuthError, SupplierNotSent, SupplierOutcomeUnknown, SupplierRequestRejected, SupplierTimeout, SupplierUnavailable } from "@/server/supplier/expedia/client";
import type { BookInput } from "@/server/supplier/types";
import { resetTestDb } from "@/test/db";
import { HotelbedsLayer } from "./adapter";
import { convertToUsdMinor, fxProblems, readFxRule, readSupplierList } from "./config";
import { LAYER_HOTEL, OFFER_ID, QUOTE_ID, REFERENCE, bookingAnswer, quoteAnswer, rateOffer, searchAnswer } from "./fixtures";

// Contract tests of the supplier layer adapter against hand-written layer answers. fetch is
// replaced: nothing here reaches the network.

const API_KEY = "k".repeat(32); // built at run time: no key-like literal in the source
const STAGING = { APP_ENV: "staging", SUPPLIER_LAYER_URL: "http://apolles-suppliers:8080", SUPPLIER_LAYER_API_KEY: API_KEY };
const FX = { HOTELBEDS_FX_CURRENCY: "EUR", HOTELBEDS_FX_TO_USD: "1.0850" };
const QUERY = { propertyIds: ["900", "901"], checkin: "2027-04-10", checkout: "2027-04-12", occupancies: [{ adults: 2, childAges: [] }], countryCode: "IL" };
const links = async (ids: string[]) => new Map(ids.filter((id) => id === "900").map((id) => [id, LAYER_HOTEL] as [string, string]));

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

function failWith(name: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const error = new Error("failed");
      error.name = name;
      throw error;
    }),
  );
}

const layer = (env: Record<string, string> = STAGING) => new HotelbedsLayer({ links, env });

const bookInput = (over: Partial<BookInput> = {}): BookInput => ({
  bookToken: Buffer.from(JSON.stringify({ q: QUOTE_ID, m: 24_680, c: "USD" })).toString("base64url"),
  affiliateReferenceId: REFERENCE,
  lead: { givenName: "Dana", familyName: "Levi", email: "dana@example.com", phone: { countryCode: "972", number: "501234567" } },
  rooms: [{ givenName: "Dana", familyName: "Levi", guests: [{ givenName: "Dana", familyName: "Levi" }, { givenName: "Avi", familyName: "Levi" }, { givenName: "Noa", familyName: "Levi" }], adults: 2, childAges: [7] }],
  ...over,
});

describe("supplier layer adapter (Hotelbeds)", () => {
  beforeEach(async () => {
    await resetTestDb();
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("search", () => {
    it("asks only for the approved hotels, by the layer's own id, for one room in USD, and returns them under our property ids", async () => {
      answer(200, searchAnswer([rateOffer()]));
      const [hotel, ...rest] = await layer().searchAvailability(QUERY);
      expect(rest).toEqual([]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: "http://apolles-suppliers:8080/v1/search", method: "POST" });
      expect(calls[0]!.headers["x-api-key"]).toBe(API_KEY);
      expect(calls[0]!.body).toEqual({ checkIn: "2027-04-10", checkOut: "2027-04-12", rooms: [{ adults: 2, childrenAges: [] }], hotelIds: [LAYER_HOTEL], currency: "USD", nationality: "IL", suppliers: ["hotelbeds"] });
      expect(hotel!.propertyId).toBe("900");
      const offer = hotel!.offers[0]!;
      expect(offer).toMatchObject({
        propertyId: "900",
        roomId: "DBL.ST",
        roomName: "Double Standard",
        refundable: true,
        amenities: ["Breakfast included"],
        supplier: "hotelbeds",
        nonrefundableDateRanges: [],
        price: { total: { minor: 24_680, currency: "USD" }, lines: [{ kind: "room_rate", amount: { minor: 24_680, currency: "USD" } }], dueAtProperty: [], dueAtPropertyTotal: null, nights: 2 },
      });
      expect(offer.roomPrices).toEqual([offer.price]);
      expect(offer.bedGroups).toEqual([{ id: "1", description: "Bed type as assigned by the hotel", priceCheckToken: OFFER_ID }]);
      // The supplier's name never shows in the ids a page can see.
      expect(offer.rateId).toMatch(/^h[0-9a-f]{24}$/);
      // "From then on it costs X" becomes windows; the supplier's dates and offsets stay as given.
      expect(offer.cancelPenalties).toEqual([
        { start: "2027-04-08T23:59:00+02:00", end: "2027-04-09T23:59:00+02:00", amount: { minor: 12_340, currency: "USD" }, nights: null, percent: null },
        { start: "2027-04-09T23:59:00+02:00", end: "2027-04-10T00:00:00Z", amount: { minor: 24_680, currency: "USD" }, nights: null, percent: null },
      ]);
    });

    it("drops offers it cannot sell as priced: pay at hotel, the other environment, another supplier, another currency, another occupancy, an unknown hotel, an offer that does not read", async () => {
      answer(
        200,
        searchAnswer([
          rateOffer({ paymentModel: "PAY_AT_HOTEL" }),
          rateOffer({ environment: "production" }),
          rateOffer({ supplierId: "tbo" }),
          rateOffer({ total: { minor: 20_000, currency: "EUR" } }),
          rateOffer({ occupancy: [{ adults: 1, childrenAges: [] }] }),
          rateOffer({ hotelId: "60" }),
          rateOffer({ total: { minor: 1.5, currency: "USD" } }),
          rateOffer({ offerId: "kept", rooms: [{ occupancyIndex: 0, supplierRoomCode: "DBL ST/1", roomName: "Double" }] }),
        ]),
      );
      const [hotel] = await layer().searchAvailability(QUERY);
      expect(hotel!.offers).toHaveLength(1);
      expect(hotel!.offers[0]!.bedGroups[0]!.priceCheckToken).toBe("kept");
      expect(hotel!.offers[0]!.roomId).toMatch(/^r[0-9a-f]{24}$/); // a room code that is not a safe id is hashed
    });

    it("no approved hotel, or more than one room: the layer is not asked", async () => {
      answer(200, searchAnswer([]));
      expect(await layer().searchAvailability({ ...QUERY, propertyIds: ["901"] })).toEqual([]);
      expect(await layer().searchAvailability({ ...QUERY, occupancies: [{ adults: 2, childAges: [] }, { adults: 1, childAges: [] }] })).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it("a refused key, an error or a timeout is a supplier error (the search goes on without the layer)", async () => {
      answer(401, { error: "UNAUTHORIZED" });
      await expect(layer().searchAvailability(QUERY)).rejects.toBeInstanceOf(SupplierAuthError);
      answer(500, { error: "INTERNAL" });
      await expect(layer().searchAvailability(QUERY)).rejects.toBeInstanceOf(SupplierUnavailable);
      failWith("TimeoutError");
      await expect(layer().searchAvailability(QUERY)).rejects.toBeInstanceOf(SupplierTimeout);
    });

    it("without its settings nothing is sent", async () => {
      answer(200, searchAnswer([rateOffer()]));
      await expect(layer({ APP_ENV: "staging" }).searchAvailability(QUERY)).rejects.toBeInstanceOf(SupplierNotSent);
      expect(calls).toHaveLength(0);
    });
  });

  describe("temporary staging-only currency conversion", () => {
    it("converts the one set currency to USD with the margin, in whole numbers, rounded up; prices, penalties and fees at the hotel alike", async () => {
      answer(
        200,
        searchAnswer([
          rateOffer({
            total: { minor: 12_345, currency: "EUR" },
            payAtHotel: [{ minor: 500, currency: "EUR" }],
            cancellation: { refundable: true, penalties: [{ from: "2027-04-08T23:59:00+02:00", amount: { minor: 12_345, currency: "EUR" } }] },
          }),
        ]),
      );
      const [hotel] = await layer({ ...STAGING, ...FX }).searchAvailability(QUERY);
      const offer = hotel!.offers[0]!;
      // 123.45 EUR × 1.0850 × 1.02 = 136.622115 USD → 136.63 (up, never down).
      expect(offer.price.total).toEqual({ minor: 13_663, currency: "USD" });
      expect(offer.cancelPenalties[0]!.amount).toEqual({ minor: 13_663, currency: "USD" }); // a full penalty stays the full price
      expect(offer.price.dueAtProperty).toEqual([{ kind: "mandatory_fee", amount: { minor: 554, currency: "USD" }, localAmount: { minor: 500, currency: "EUR" } }]);
      expect(offer.price.dueAtPropertyTotal).toEqual({ minor: 554, currency: "USD" });
    });

    it("the arithmetic: exact cases stay exact, everything else goes up by less than a cent", () => {
      const env = { APP_ENV: "staging" };
      const rule = readFxRule({ ...env, ...FX, HOTELBEDS_FX_MARGIN_PERCENT: "0" })!;
      expect(convertToUsdMinor(10_000, rule, env)).toBe(10_850);
      expect(convertToUsdMinor(1, rule, env)).toBe(2); // 1.085 cents → 2
      expect(convertToUsdMinor(0, rule, env)).toBe(0);
      expect(convertToUsdMinor(-1, rule, env)).toBeNull();
      const withMargin = readFxRule({ ...env, ...FX })!; // default 2%
      expect(convertToUsdMinor(10_000, withMargin, env)).toBe(11_067);
    });

    it("is impossible in production: refused when read, refused when used, and a non-USD rate is dropped there", async () => {
      const production = { ...STAGING, APP_ENV: "production" };
      expect(() => readFxRule({ ...production, ...FX })).toThrow(/staging-only/);
      expect(fxProblems({ ...production, ...FX })).toHaveLength(1);
      expect(fxProblems({ NODE_ENV: "production", ...FX })).toHaveLength(1); // a production build that is not staging
      const rule = readFxRule({ APP_ENV: "staging", ...FX })!;
      expect(() => convertToUsdMinor(100, rule, { APP_ENV: "production" })).toThrow(/not allowed in production/);
      answer(200, searchAnswer([rateOffer({ environment: "production" })]));
      await expect(layer({ ...production, ...FX }).searchAvailability(QUERY)).rejects.toThrow(/staging-only/);
      expect(calls).toHaveLength(0);
      answer(200, searchAnswer([rateOffer({ environment: "production", total: { minor: 20_000, currency: "EUR" } }), rateOffer({ environment: "production", offerId: "usd" }), rateOffer({ offerId: "test-side" })]));
      const [hotel] = await layer(production).searchAvailability(QUERY);
      expect(hotel!.offers.map((o) => o.bedGroups[0]!.priceCheckToken)).toEqual(["usd"]); // USD and production only
    });

    it("bad settings are named", () => {
      expect(fxProblems({ APP_ENV: "staging", HOTELBEDS_FX_CURRENCY: "JPY", HOTELBEDS_FX_TO_USD: "abc", HOTELBEDS_FX_MARGIN_PERCENT: "50" })).toHaveLength(3);
      expect(fxProblems({ APP_ENV: "staging", HOTELBEDS_FX_CURRENCY: "EUR", HOTELBEDS_FX_TO_USD: "0" })).toHaveLength(1);
      expect(fxProblems({ APP_ENV: "staging" })).toEqual([]);
    });
  });

  describe("price check", () => {
    const ref = { propertyId: "900", roomId: "DBL.ST", rateId: "h", token: OFFER_ID, occupancies: [{ adults: 2, childAges: [] }] };

    it("quotes the offer; the book token carries the quote and the total the layer quoted", async () => {
      answer(200, quoteAnswer());
      const result = await layer().priceCheck(ref);
      expect(calls[0]).toMatchObject({ url: "http://apolles-suppliers:8080/v1/quotes", method: "POST", body: { offerId: OFFER_ID } });
      expect(result).toMatchObject({ status: "available", price: { total: { minor: 24_680, currency: "USD" } } });
      if (result.status === "sold_out") throw new Error("unexpected");
      expect(JSON.parse(Buffer.from(result.bookToken, "base64url").toString("utf8"))).toEqual({ q: QUOTE_ID, m: 24_680, c: "USD" });
      answer(200, quoteAnswer({ priceChanged: true }, rateOffer({ total: { minor: 25_000, currency: "USD" } })));
      expect(await layer().priceCheck(ref)).toMatchObject({ status: "price_changed", price: { total: { minor: 25_000 } } });
    });

    it("sold out: gone (409), expired (410), another environment, another offer, new cancellation terms", async () => {
      for (const [status, body] of [
        [409, { error: "SOLD_OUT" }],
        [410, { error: "OFFER_EXPIRED" }],
        [200, quoteAnswer({ environment: "production" })],
        [200, quoteAnswer({}, rateOffer({ offerId: "other" }))],
        [200, quoteAnswer({ cancellationChanged: true })],
      ] as const) {
        answer(status, body);
        expect(await layer().priceCheck(ref), JSON.stringify(body)).toEqual({ status: "sold_out" });
      }
    });

    it("a refused key or a layer error is a supplier error, never a price", async () => {
      answer(403, { error: "UNAUTHORIZED" });
      await expect(layer().priceCheck(ref)).rejects.toBeInstanceOf(SupplierAuthError);
      answer(502, { error: "SUPPLIER_UNAVAILABLE" });
      await expect(layer().priceCheck(ref)).rejects.toBeInstanceOf(SupplierUnavailable);
      answer(200, "not json");
      await expect(layer().priceCheck(ref)).rejects.toBeInstanceOf(SupplierUnavailable);
    });
  });

  describe("book", () => {
    it("sends our reference, the quote, the quoted total, every guest with child ages, and agency credit", async () => {
      answer(201, bookingAnswer());
      expect(await layer().book(bookInput({ specialRequest: "Late check-out." }))).toEqual({ itineraryId: "102-4455667", links: {} });
      expect(calls[0]).toMatchObject({ url: "http://apolles-suppliers:8080/v1/bookings", method: "POST" });
      expect(calls[0]!.body).toEqual({
        clientReference: REFERENCE,
        quoteId: QUOTE_ID,
        approvedTotal: { minor: 24_680, currency: "USD" },
        holder: { firstName: "Dana", lastName: "Levi", email: "dana@example.com", phone: "+972 501234567" },
        guests: [
          [
            { firstName: "Dana", lastName: "Levi", type: "ADULT" },
            { firstName: "Avi", lastName: "Levi", type: "ADULT" },
            { firstName: "Noa", lastName: "Levi", type: "CHILD", age: 7 },
          ],
        ],
        payment: { type: "AGENCY_CREDIT" },
        specialRequests: "Late check-out.",
      });
      // The log keeps the call, never the guests.
      const log = await db.supplierCallLog.findFirstOrThrow({ where: { supplier: "hotelbeds", path: "/v1/bookings" } });
      expect(log.affiliateReferenceId).toBe(REFERENCE);
      expect(JSON.stringify([log.requestBody, log.responseBody])).not.toMatch(/Dana|Levi|dana@example\.com|501234567/);
    });

    it("`booked` decides, never the HTTP status: 201 FAILED is a definite no; 201 UNKNOWN, ON_REQUEST or NEEDS_REVIEW means the layer has it", async () => {
      answer(201, bookingAnswer({ status: "FAILED", booked: false, supplierBookingRef: undefined }));
      await expect(layer().book(bookInput())).rejects.toBeInstanceOf(SupplierRequestRejected);
      for (const status of ["UNKNOWN", "ON_REQUEST", "NEEDS_REVIEW", "PENDING"]) {
        answer(201, bookingAnswer({ status, booked: false, supplierBookingRef: undefined }));
        expect(await layer().book(bookInput()), status).toEqual({ itineraryId: REFERENCE, links: {} });
      }
    });

    it("only a refusal before the layer stored anything is a definite no; everything else is outcome unknown", async () => {
      const definite: [number, unknown, unknown][] = [
        [400, { error: "INVALID_REQUEST" }, SupplierRequestRejected],
        [401, { error: "UNAUTHORIZED" }, SupplierAuthError],
        [410, { error: "QUOTE_EXPIRED" }, SupplierRequestRejected],
        [409, { error: "QUOTE_ALREADY_USED" }, SupplierRequestRejected],
        [409, { error: "PRICE_CHANGED" }, SupplierRequestRejected],
      ];
      const unclear: [number, unknown][] = [
        [409, { error: "REFERENCE_REUSED" }], // this reference already has a booking there
        [409, { error: "SOMETHING_NEW" }],
        [404, { error: "NOT_FOUND" }],
        [429, {}],
        [500, { error: "INTERNAL" }],
        [502, { error: "SUPPLIER_OUTCOME_UNKNOWN" }],
        [302, {}],
        [201, "not json"],
        [201, bookingAnswer({ clientReference: "APL-SOMEONEELS" })],
      ];
      for (const [status, body, kind] of definite) {
        answer(status, body);
        await expect(layer().book(bookInput()), `${status}`).rejects.toBeInstanceOf(kind as typeof SupplierRequestRejected);
      }
      for (const [status, body] of unclear) {
        answer(status, body);
        await expect(layer().book(bookInput()), `${status} ${JSON.stringify(body).slice(0, 40)}`).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
      }
      for (const name of ["TimeoutError", "TypeError"]) {
        failWith(name);
        await expect(layer().book(bookInput()), name).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
      }
    });

    it("nothing is sent with a reference outside the layer's rule, an unreadable token, several rooms, missing guests or missing settings", async () => {
      answer(201, bookingAnswer());
      const room = bookInput().rooms[0]!;
      for (const input of [
        bookInput({ affiliateReferenceId: "APL_1" }),
        bookInput({ affiliateReferenceId: "APL-ABCDEFGHJKLMNPQRSTUV" }),
        bookInput({ bookToken: "nope" }),
        bookInput({ rooms: [room, room] }),
        bookInput({ rooms: [{ givenName: "Dana", familyName: "Levi" }] }),
      ]) {
        await expect(layer().book(input)).rejects.toBeInstanceOf(SupplierNotSent);
      }
      await expect(layer({ APP_ENV: "staging" }).book(bookInput())).rejects.toBeInstanceOf(SupplierNotSent);
      expect(calls).toHaveLength(0);
    });
  });

  describe("booking lookup and cancel", () => {
    const find = () => layer().findByAffiliateReference({ affiliateReferenceId: REFERENCE, email: "dana@example.com" });

    it("reads the booking by our reference: confirmed is booked, with its reference as the cancel link", async () => {
      answer(200, bookingAnswer());
      expect(await find()).toEqual({
        itineraryId: "102-4455667",
        rooms: [{ id: "102-4455667", status: "booked", hotelConfirmationId: "HC-88123", cancelLink: REFERENCE, givenName: "Dana", familyName: "Levi" }],
      });
      expect(calls[0]).toMatchObject({ url: `http://apolles-suppliers:8080/v1/bookings/${REFERENCE}`, method: "GET" });
    });

    it("each layer status as a room status; a review reason asks for an admin; the other environment is never booked; 404 is not found", async () => {
      const cases: [Record<string, unknown>, string][] = [
        [{ status: "ON_REQUEST" }, "pending"],
        [{ status: "UNKNOWN" }, "pending"],
        [{ status: "PENDING" }, "pending"],
        [{ status: "CANCELLED" }, "cancelled"],
        [{ status: "FAILED" }, "cancelled"],
        [{ status: "NEEDS_REVIEW", cancelOutcomeUnknown: true }, "other"],
        [{ environment: "production" }, "other"],
      ];
      for (const [over, status] of cases) {
        answer(200, bookingAnswer(over));
        const found = await find();
        expect(found!.rooms[0]!.status, JSON.stringify(over)).toBe(status);
        expect(found!.rooms[0]!.cancelLink).toBeNull();
      }
      answer(200, bookingAnswer({ reviewReason: "Supplier total is above the approved total" }));
      expect(await find()).toMatchObject({ reviewNeeded: true, rooms: [{ status: "booked" }] });
      answer(404, { error: "NOT_FOUND" });
      expect(await find()).toBeNull();
      answer(500, { error: "INTERNAL" });
      await expect(find()).rejects.toBeInstanceOf(SupplierUnavailable);
    });

    it("cancel: CANCELLED is done; refused or still active is a definite no; anything unclear is outcome unknown", async () => {
      answer(200, bookingAnswer({ status: "CANCELLED", booked: false }));
      await layer().cancelRoom(REFERENCE);
      expect(calls[0]).toMatchObject({ url: `http://apolles-suppliers:8080/v1/bookings/${REFERENCE}/cancel`, method: "POST" });
      for (const [status, body] of [
        [409, { error: "CANCEL_REFUSED" }],
        [409, { error: "CANCEL_NOT_DONE" }],
        [409, { error: "NOT_SUPPORTED" }],
        [404, { error: "NOT_FOUND" }],
      ] as const) {
        answer(status, body);
        await expect(layer().cancelRoom(REFERENCE), body.error).rejects.toBeInstanceOf(SupplierRequestRejected);
      }
      for (const [status, body] of [
        [200, bookingAnswer({ status: "NEEDS_REVIEW", cancelOutcomeUnknown: true, booked: false })],
        [409, { error: "NOT_CANCELLABLE" }],
        [500, { error: "INTERNAL" }],
      ] as const) {
        answer(status, body);
        await expect(layer().cancelRoom(REFERENCE)).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
      }
      failWith("TimeoutError");
      await expect(layer().cancelRoom(REFERENCE)).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
      calls = [];
      await expect(layer().cancelRoom("../admin")).rejects.toBeInstanceOf(SupplierNotSent);
      expect(calls).toHaveLength(0);
    });
  });
});

describe("SUPPLIERS", () => {
  it("unset is the main supplier only; one main supplier, optionally with hotelbeds; anything else is refused", () => {
    expect(readSupplierList({})).toEqual({ main: null, hotelbeds: false });
    expect(readSupplierList({ SUPPLIERS: "expedia,hotelbeds" })).toEqual({ main: "expedia", hotelbeds: true });
    expect(readSupplierList({ SUPPLIERS: " Fake , hotelbeds " })).toEqual({ main: "fake", hotelbeds: true });
    expect(readSupplierList({ SUPPLIERS: "expedia" })).toEqual({ main: "expedia", hotelbeds: false });
    for (const bad of ["hotelbeds", "expedia,fake", "expedia,tbo", "expedia,expedia,hotelbeds"]) expect(() => readSupplierList({ SUPPLIERS: bad }), bad).toThrow(/SUPPLIERS/);
  });
});

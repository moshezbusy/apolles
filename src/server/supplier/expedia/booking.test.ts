import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDb } from "@/test/db";
import { ExpediaBooking, SupplierNotSent, linkPath } from "./booking";
import { SupplierOutcomeUnknown, SupplierRequestRejected } from "./client";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
}
function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const expedia = new ExpediaBooking();
const lead = { givenName: "Dana", familyName: "Levi", email: "dana@example.com", phone: { countryCode: "972", number: "501234567" } };

describe("ExpediaBooking", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(async () => {
    await resetTestDb();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPEDIA_API_KEY", "k");
    vi.stubEnv("EXPEDIA_SHARED_SECRET", "s");
    vi.stubEnv("EXPEDIA_BASE_URL", "");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("EXPEDIA_BILLING_GIVEN_NAME", "Taya");
    vi.stubEnv("EXPEDIA_BILLING_FAMILY_NAME", "Tourism");
    vi.stubEnv("EXPEDIA_BILLING_ADDRESS_LINE1", "1 Example St");
    vi.stubEnv("EXPEDIA_BILLING_CITY", "Tel Aviv");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("books with affiliate collect, our reference, the lead guest and the Test header; reads the itinerary id", async () => {
    fetchMock.mockResolvedValue(json(201, fixture("book.response.json")));
    const result = await expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, { customerIp: "203.0.113.9" });
    expect(result).toEqual({ itineraryId: "8999989898988", links: { retrieve: "/v3/itineraries/8999989898988?token=tok-bk1" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://test.ean.com/v3/itineraries?token=tok-bk1");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("test")).toBe("standard");
    expect(JSON.parse(String(init?.body))).toEqual({
      affiliate_reference_id: "APL-ABCD2345",
      hold: false,
      email: "dana@example.com",
      phone: { country_code: "972", number: "501234567" },
      rooms: [{ given_name: "Dana", family_name: "Levi", smoking: false }],
      payments: [{ type: "affiliate_collect", billing_contact: { given_name: "Taya", family_name: "Tourism", address: { line_1: "1 Example St", city: "Tel Aviv", country_code: "IL" } } }],
    });
  });

  it("without the billing contact set, nothing is sent", async () => {
    vi.stubEnv("EXPEDIA_BILLING_CITY", "");
    await expect(expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, {})).rejects.toBeInstanceOf(SupplierNotSent);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("price mismatch (409) and sold out (410) are a definite no; 500 is not known", async () => {
    fetchMock.mockResolvedValueOnce(json(409, fixture("book.error-409.json")));
    await expect(expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, {})).rejects.toBeInstanceOf(SupplierRequestRejected);
    fetchMock.mockResolvedValueOnce(json(410, fixture("book.error-410.json")));
    await expect(expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, {})).rejects.toBeInstanceOf(SupplierRequestRejected);
    fetchMock.mockResolvedValueOnce(json(500, fixture("book.error-500.json")));
    await expect(expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, {})).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
  });

  it("a 201 that cannot be read is 'not known', never 'failed'", async () => {
    fetchMock.mockResolvedValue(json(201, { unexpected: true }));
    await expect(expedia.book({ bookToken: "tok-bk1", affiliateReferenceId: "APL-ABCD2345", lead }, {})).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
  });

  it("finds a booking by affiliate reference; an empty list means none", async () => {
    fetchMock.mockResolvedValueOnce(json(200, fixture("retrieve-by-affiliate-ref.no-itineraries.response.json")));
    expect(await expedia.findByAffiliateReference({ affiliateReferenceId: "APL-ABCD2345", email: "dana@example.com" }, {})).toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v3/itineraries");
    expect(Object.fromEntries(url.searchParams)).toEqual({ affiliate_reference_id: "APL-ABCD2345", email: "dana@example.com" });
    fetchMock.mockResolvedValueOnce(json(200, fixture("retrieve-by-affiliate-ref.response.json")));
    const found = await expedia.findByAffiliateReference({ affiliateReferenceId: "APL-ABCD2345", email: "dana@example.com" }, {});
    expect(found?.itineraryId).toBe("8999989898988");
    expect(found?.rooms[0]).toMatchObject({ status: expect.stringMatching(/booked|cancelled|pending|other/) });
  });

  it("retrieves an itinerary from its link: room status, hotel confirmation number, cancel link", async () => {
    fetchMock.mockResolvedValue(json(200, fixture("retrieve.no-history.response.json")));
    const itinerary = await expedia.retrieve({ retrieve: "/v3/itineraries/8999989898988?token=tok-rt1" }, {});
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://test.ean.com/v3/itineraries/8999989898988?token=tok-rt1");
    expect(itinerary.rooms[0]).toEqual({
      id: "926784314",
      status: "booked",
      hotelConfirmationId: "BEF23123AA",
      cancelLink: "/v3/itineraries/8999989898988/rooms/d08572fc-82d2-4d5d-ad30-60f5be7fb53e?token=tok-rn2",
    });
  });

  it("cancel: 204 is done; 202 is not known yet", async () => {
    fetchMock.mockResolvedValueOnce(json(204, null));
    await expedia.cancelRoom("/v3/itineraries/1/rooms/2?token=tok-rn2", {});
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("test")).toBe("standard");
    fetchMock.mockResolvedValueOnce(json(202, null));
    await expect(expedia.cancelRoom("/v3/itineraries/1/rooms/2?token=tok-rn2", {})).rejects.toBeInstanceOf(SupplierOutcomeUnknown);
  });

  it("refuses a link to another host or outside /v3", () => {
    expect(() => linkPath("https://evil.example/v3/itineraries/1?token=x")).toThrow();
    expect(() => linkPath("/admin?x=1")).toThrow();
    expect(linkPath("/v3/itineraries/1?token=x")).toBe("/itineraries/1?token=x");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_LOG_BODY_BYTES, forLog, maskPii, maskQuery } from "./mask";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./expedia/fixtures/${name}`, import.meta.url), "utf8"));

describe("maskPii", () => {
  it("masks personal fields at any depth and keeps the structure", () => {
    expect(
      maskPii({
        email: "a@b.c",
        phone: { country_code: "972", area_code: "50", number: "1234567" },
        rooms: [{ given_name: "Dana", family_name: "Levi", smoking: false }],
        property_id: "123",
        name: "Hotel Name",
      }),
    ).toEqual({
      email: "[masked]",
      phone: { country_code: "972", area_code: "[masked]", number: "[masked]" },
      rooms: [{ given_name: "[masked]", family_name: "[masked]", smoking: false }],
      property_id: "123",
      name: "Hotel Name",
    });
  });

  it("leaves null and non-objects alone", () => {
    expect(maskPii(null)).toBeNull();
    expect(maskPii("x")).toBe("x");
    expect(maskPii({ email: null })).toEqual({ email: null });
  });
});

describe("maskPii: booking request fields", () => {
  it("masks card, authentication, loyalty, traveler and tax fields, whole subtrees included", () => {
    const masked = JSON.stringify(
      maskPii({
        payments: [{ number: "4111111111111111", security_code: "123", expiration_month: "12", expiration_year: "2030",
          third_party_authentication: { cavv: "c", xid: "x", ds_transaction_id: "d" } }],
        rooms: [{ loyalty_id: "L1", sensitive_traveler_details: { middle_name: "M", date_of_birth: "1990-01-01" } }],
        tax_registration_number: "T", vat_number: "V", traveler_handling_instructions: "note", affiliate_metadata: "meta-value-x",
        email: ["a@b.c", "d@e.f"],
      }),
    );
    for (const secret of ["4111111111111111", "123", "2030", '"c"', '"x"', '"d"', "L1", '"M"', "1990-01-01", '"T"', '"V"', "note", "meta-value-x", "a@b.c"]) {
      expect(masked).not.toContain(secret);
    }
  });
});

describe("maskQuery", () => {
  it("masks email and token values in a logged path", () => {
    expect(maskQuery("/itineraries?email=a%40b.c&affiliate_reference_id=APL-1&token=abc")).toBe(
      "/itineraries?email=%5Bmasked%5D&affiliate_reference_id=APL-1&token=%5Bmasked%5D",
    );
    expect(maskQuery("/properties/availability")).toBe("/properties/availability");
  });
});

describe("forLog", () => {
  it("replaces a body over the size cap with a marker", () => {
    const big = { data: "x".repeat(MAX_LOG_BODY_BYTES + 1) };
    expect(forLog(big)).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(forLog(undefined)).toBeUndefined();
  });
});

// Expedia answers a refused booking with the offending input echoed back under errors[].fields[]:
// the guest's email, phone or name can come back there.
describe("maskPii: Expedia error fields", () => {
  it("masks the echoed value of every field, at any depth, and keeps which field it was", () => {
    const masked = maskPii({
      type: "invalid_input",
      errors: [
        { type: "email.invalid", message: "Email is invalid.", fields: [{ name: "email", type: "body", value: "dana.levi@example.com" }] },
        { type: "phone.invalid", fields: [{ name: "phone.number", type: "body", value: 501234567 }, { name: "rooms[0].given_name", type: "body", value: "Dana" }] },
      ],
      fields: [{ name: "Customer-Ip", type: "header", value: "203.0.113.7" }],
    });
    expect(masked).toEqual({
      type: "invalid_input",
      errors: [
        { type: "email.invalid", message: "Email is invalid.", fields: [{ name: "email", type: "body", value: "[masked]" }] },
        { type: "phone.invalid", fields: [{ name: "phone.number", type: "body", value: "[masked]" }, { name: "rooms[0].given_name", type: "body", value: "[masked]" }] },
      ],
      fields: [{ name: "Customer-Ip", type: "header", value: "[masked]" }],
    });
  });

  it("masks structured and null values under fields without breaking on odd shapes", () => {
    expect(maskPii({ fields: [{ name: "a", value: { deep: "secret", list: ["x", 1] } }, { name: "b", value: null }, "text", null] })).toEqual({
      fields: [{ name: "a", value: { deep: "[masked]", list: ["[masked]", "[masked]"] } }, { name: "b", value: null }, "text", null],
    });
    expect(maskPii({ fields: "not a list" })).toEqual({ fields: "not a list" });
  });

  it("the documented duplicate-itinerary error keeps its shape with the value masked", () => {
    const masked = maskPii(fixture("book.error-400-duplicate-itinerary.json")) as { errors: { fields: unknown[] }[] };
    expect(masked.errors[0]?.fields).toEqual([{ name: "affiliate_reference_id", type: "body", value: "[masked]" }]);
    expect(JSON.stringify(masked)).not.toContain("ABCD");
  });

  it("a value outside an error's fields list is left alone (amounts, ids)", () => {
    expect(maskPii({ totals: { value: "120.00", currency: "USD" }, amenities: [{ id: 1, value: "Free WiFi" }] })).toEqual({
      totals: { value: "120.00", currency: "USD" },
      amenities: [{ id: 1, value: "Free WiFi" }],
    });
  });
});

// Rapid links carry a token that acts as a key to the price check or the booking.
describe("maskPii: link tokens", () => {
  it("masks the token inside href links and any other text, and keeps the rest of the link", () => {
    expect(
      maskPii({
        links: {
          retrieve: { method: "GET", href: "/v3/itineraries/8999989898988?token=tok-ar1" },
          book: { method: "POST", href: "/v3/itineraries?token=tok-b1&other=1" },
        },
        message: "Call https://test.ean.com/v3/itineraries/1?foo=1&token=abc.DEF-123_x#frag next",
        price_check: "token=first&token=second",
      }),
    ).toEqual({
      links: {
        retrieve: { method: "GET", href: "/v3/itineraries/8999989898988?token=[masked]" },
        book: { method: "POST", href: "/v3/itineraries?token=[masked]&other=1" },
      },
      message: "Call https://test.ean.com/v3/itineraries/1?foo=1&token=[masked]#frag next",
      price_check: "token=[masked]&token=[masked]",
    });
  });

  it("no token of the documented availability and retrieve answers survives", () => {
    for (const name of ["availability.usd.json", "retrieve-by-affiliate-ref.response.json", "book.response.json", "price-check.usd-available.json"]) {
      const text = JSON.stringify(maskPii(fixture(name)));
      expect(text, name).not.toMatch(/token=(?!\[masked\])/);
    }
    expect(JSON.stringify(maskPii(fixture("retrieve-by-affiliate-ref.response.json")))).not.toContain("tok-ar");
  });

  it("text without a token is unchanged", () => {
    expect(maskPii({ href: "/v3/properties/1/availability?checkin=2027-01-01", note: "tokens are fine" })).toEqual({
      href: "/v3/properties/1/availability?checkin=2027-01-01",
      note: "tokens are fine",
    });
  });
});

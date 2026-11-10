import { describe, expect, it } from "vitest";
import { MAX_LOG_BODY_BYTES, forLog, maskPii, maskQuery } from "./mask";

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

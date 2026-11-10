import { describe, expect, it } from "vitest";
import { MAX_LOG_BODY_BYTES, forLog, maskPii } from "./mask";

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

describe("forLog", () => {
  it("replaces a body over the size cap with a marker", () => {
    const big = { data: "x".repeat(MAX_LOG_BODY_BYTES + 1) };
    expect(forLog(big)).toEqual({ truncated: true, bytes: expect.any(Number) });
    expect(forLog(undefined)).toBeUndefined();
  });
});

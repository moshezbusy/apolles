import { describe, expect, it } from "vitest";
import { COUNTRY_CODES } from "@/lib/countries";
import { callingCode, toE164Digits } from "@/lib/phone";

describe("toE164Digits", () => {
  it("a local number gets the default country's code, without its one leading 0", () => {
    // Before: wa.me/0501234567 and tel:+0501234567.
    expect(toE164Digits("050-123 4567", "IL")).toBe("972501234567");
    expect(toE164Digits("(03) 555 1234", "IL")).toBe("97235551234");
    expect(toE164Digits("07700 900123", "GB")).toBe("447700900123");
    expect(toE164Digits("50 123 4567", "IL")).toBe("972501234567");
    // Spain has no leading 0 at all.
    expect(toE164Digits("612 34 56 78", "ES")).toBe("34612345678");
  });

  it("an international number stays as typed, whatever the default country", () => {
    expect(toE164Digits("+972 50 123 4567", "US")).toBe("972501234567");
    expect(toE164Digits("00972 50-123-4567", "US")).toBe("972501234567");
    expect(toE164Digits("+1 (555) 123-4567", "IL")).toBe("15551234567");
  });

  it("North America: ten digits, or eleven starting with 1", () => {
    expect(toE164Digits("(555) 123-4567", "US")).toBe("15551234567");
    expect(toE164Digits("1 555 123 4567", "CA")).toBe("15551234567");
    expect(toE164Digits("555 1234", "US")).toBeNull();
    expect(toE164Digits("055 123 4567", "US")).toBeNull();
  });

  it("Italy keeps the 0 of a landline", () => {
    expect(toE164Digits("06 1234 5678", "IT")).toBe("390612345678");
    expect(toE164Digits("333 123 4567", "IT")).toBe("393331234567");
  });

  it("no result when it would be a guess", () => {
    // Could be +972 50 123 4567 typed without the +, or a local number: not used.
    expect(toE164Digits("972 50 123 4567", "IL")).toBeNull();
    // A country with no calling code of its own, a number too short or too long, or a "+0...".
    expect(toE164Digits("050 123 4567", "AQ")).toBeNull();
    expect(toE164Digits("+0501234567", "IL")).toBeNull();
    expect(toE164Digits("+12", "IL")).toBeNull();
    expect(toE164Digits("+1234567890123456", "IL")).toBeNull();
    expect(toE164Digits("", "IL")).toBeNull();
  });

  it("every calling code in the table is 1 to 3 digits and belongs to a known country", () => {
    const withCode = COUNTRY_CODES.filter((c) => callingCode(c) !== null);
    expect(withCode.length).toBeGreaterThan(230);
    for (const c of withCode) expect(callingCode(c)).toMatch(/^[1-9]\d{0,2}$/);
    expect(callingCode("IL")).toBe("972");
    expect(callingCode("XX")).toBeNull();
  });
});

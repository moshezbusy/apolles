import { describe, expect, it } from "vitest";
import { InvalidAmount, currencyExponent, formatMinor, parseAmount } from "./supplier-money";

describe("currencyExponent", () => {
  it("knows the ISO 4217 minor units", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    // ISO 4217 says 2 for these, though the runtime's ICU data says 0: the table wins.
    expect(currencyExponent("IDR")).toBe(2);
    expect(currencyExponent("HUF")).toBe(2);
    expect(currencyExponent("COP")).toBe(2);
  });

  it("rejects unknown currency codes", () => {
    expect(() => currencyExponent("XYZ")).toThrow(InvalidAmount);
  });

  it("rejects codes that are not three uppercase letters", () => {
    expect(() => currencyExponent("usd")).toThrow(InvalidAmount);
    expect(() => currencyExponent("US")).toThrow(InvalidAmount);
  });
});

describe("parseAmount (Rapid decimal strings → integer minor units)", () => {
  it.each([
    ["74.97", "USD", 7497],
    ["74.9", "USD", 7490],
    ["74", "USD", 7400],
    ["0.00", "USD", 0],
    ["1000", "JPY", 1000],
    ["12.345", "KWD", 12345],
    ["123456.78", "EUR", 12345678],
    ["150000.00", "IDR", 15000000],
    ["1000.00", "JPY", 1000], // extra decimals are fine when they are zeros
    ["74.970", "USD", 7497],
  ])("%s %s → %i", (value, currency, minor) => {
    expect(parseAmount(value, currency)).toEqual({ minor, currency });
  });

  it.each([
    ["74.975", "USD", "more decimals than the currency has"],
    ["1000.5", "JPY", "decimals on a zero-decimal currency"],
    ["abc", "USD", "not a number"],
    ["", "USD", "empty"],
    ["1e3", "USD", "exponent notation"],
    [" 74.97", "USD", "whitespace"],
    ["74,97", "USD", "comma"],
    ["-5.00", "USD", "negative by default"],
    ["99999999999999999", "USD", "beyond a safe integer"],
  ])("rejects %j %s (%s)", (value, currency) => {
    expect(() => parseAmount(value, currency)).toThrow(InvalidAmount);
  });

  it("never returns -0", () => {
    expect(Object.is(parseAmount("-0.00", "USD", { allowNegative: true }).minor, 0)).toBe(true);
  });

  it("accepts a negative amount only when asked", () => {
    expect(parseAmount("-5.00", "USD", { allowNegative: true })).toEqual({ minor: -500, currency: "USD" });
  });
});

describe("formatMinor", () => {
  it("formats with the currency's decimals", () => {
    expect(formatMinor(7497, "USD")).toBe("USD 74.97");
    expect(formatMinor(123456789, "EUR")).toBe("EUR 1,234,567.89");
    expect(formatMinor(1000, "JPY")).toBe("JPY 1,000");
    expect(formatMinor(12345, "KWD")).toBe("KWD 12.345");
    expect(formatMinor(-500, "USD")).toBe("-USD 5.00");
  });
});

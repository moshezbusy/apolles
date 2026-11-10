import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, isCountryCode } from "./countries";

describe("countries", () => {
  it("has the ISO 3166-1 alpha-2 codes, uppercase, without duplicates", () => {
    expect(COUNTRY_CODES).toContain("IL");
    expect(COUNTRY_CODES).toContain("US");
    expect(COUNTRY_CODES).toContain("GB");
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(240);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("names countries in English", () => {
    expect(countryName("IL")).toBe("Israel");
    expect(countryName("US")).toBe("United States");
  });

  it("has an English name for every code (no code shown raw in the list)", () => {
    for (const code of COUNTRY_CODES) expect(countryName(code), code).not.toBe(code);
  });

  it("accepts only listed codes", () => {
    expect(isCountryCode("IL")).toBe(true);
    expect(isCountryCode("il")).toBe(false);
    expect(isCountryCode("XX")).toBe(false);
  });
});

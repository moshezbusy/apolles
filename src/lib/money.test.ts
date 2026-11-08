import { describe, expect, it } from "vitest";
import { formatUsd, parseUsdToCents } from "@/lib/money";

describe("formatUsd", () => {
  it("formats integer cents as USD with thousands separators", () => {
    expect(formatUsd(123456)).toBe("USD 1,234.56");
    expect(formatUsd(0)).toBe("USD 0.00");
    expect(formatUsd(5)).toBe("USD 0.05");
    expect(formatUsd(100)).toBe("USD 1.00");
    expect(formatUsd(99999999)).toBe("USD 999,999.99");
    expect(formatUsd(100000000)).toBe("USD 1,000,000.00");
  });

  it("shows negative values as -USD", () => {
    expect(formatUsd(-1234)).toBe("-USD 12.34");
    expect(formatUsd(-5)).toBe("-USD 0.05");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatUsd(1.5)).toThrow();
    expect(() => formatUsd(Number.NaN)).toThrow();
  });
});

describe("parseUsdToCents", () => {
  it("parses plain and grouped amounts to integer cents", () => {
    expect(parseUsdToCents("250")).toBe(25000);
    expect(parseUsdToCents("1,000.00")).toBe(100000);
    expect(parseUsdToCents("1000.5")).toBe(100050);
    expect(parseUsdToCents("0.01")).toBe(1);
    expect(parseUsdToCents("12.34")).toBe(1234);
    expect(parseUsdToCents("1,234,567.89")).toBe(123456789);
    expect(parseUsdToCents("  42.10  ")).toBe(4210);
    expect(parseUsdToCents("007")).toBe(700);
  });

  it("avoids float rounding (string math only)", () => {
    expect(parseUsdToCents("0.29")).toBe(29); // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseUsdToCents("1.15")).toBe(115);
    expect(parseUsdToCents("4.35")).toBe(435);
  });

  it("accepts the maximum 21,474,836.47 and rejects one cent more", () => {
    expect(parseUsdToCents("21,474,836.47")).toBe(2147483647);
    expect(parseUsdToCents("21474836.47")).toBe(2147483647);
    expect(parseUsdToCents("21474836.48")).toBeNull();
    expect(parseUsdToCents("99999999999999999999999")).toBeNull();
  });

  it("rejects zero", () => {
    for (const text of ["0", "0.00", "0,000", "-0", "-0.00"]) {
      expect(parseUsdToCents(text, { allowNegative: true })).toBeNull();
    }
  });

  it("rejects negatives unless allowed", () => {
    expect(parseUsdToCents("-12.50")).toBeNull();
    expect(parseUsdToCents("-12.50", { allowNegative: false })).toBeNull();
    expect(parseUsdToCents("-12.50", { allowNegative: true })).toBe(-1250);
    expect(parseUsdToCents("-1,000", { allowNegative: true })).toBe(-100000);
    expect(parseUsdToCents("-21,474,836.47", { allowNegative: true })).toBe(-2147483647);
    expect(parseUsdToCents("-21,474,836.48", { allowNegative: true })).toBeNull();
  });

  it("rejects malformed text", () => {
    for (const text of [
      "",
      "   ",
      "abc",
      "NaN",
      "Infinity",
      "1.234",
      "1.",
      ".5",
      "1e5",
      "0x10",
      "1,00",
      "1,0000",
      "1000,000",
      ",100",
      "1 000",
      "$100",
      "USD 100",
      "+100",
      "--5",
      "1.2.3",
      "12-",
    ]) {
      expect(parseUsdToCents(text, { allowNegative: true }), JSON.stringify(text)).toBeNull();
    }
  });
});

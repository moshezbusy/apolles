import { describe, expect, it } from "vitest";
import { formatUsd } from "@/lib/money";

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

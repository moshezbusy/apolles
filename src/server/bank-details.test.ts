import { afterEach, describe, expect, it } from "vitest";
import { getBankDetails } from "@/server/bank-details";

const NAMES = [
  "BANK_DETAILS_BENEFICIARY",
  "BANK_DETAILS_BANK_NAME",
  "BANK_DETAILS_ACCOUNT_NUMBER",
  "BANK_DETAILS_IBAN",
  "BANK_DETAILS_SWIFT",
] as const;

describe("getBankDetails", () => {
  afterEach(() => {
    for (const name of NAMES) delete process.env[name];
  });

  it("returns every configured line, in a fixed order, with its label", () => {
    process.env.BANK_DETAILS_BENEFICIARY = "Apolles Ltd";
    process.env.BANK_DETAILS_BANK_NAME = "Test Bank";
    process.env.BANK_DETAILS_ACCOUNT_NUMBER = "123456";
    process.env.BANK_DETAILS_IBAN = "IL00 0000 0000 0000";
    process.env.BANK_DETAILS_SWIFT = "TESTILIT";
    expect(getBankDetails()).toEqual([
      { label: "Beneficiary", value: "Apolles Ltd" },
      { label: "Bank", value: "Test Bank" },
      { label: "Account number", value: "123456" },
      { label: "IBAN", value: "IL00 0000 0000 0000" },
      { label: "SWIFT", value: "TESTILIT" },
    ]);
  });

  it("leaves out lines that are not set or blank, and trims values", () => {
    process.env.BANK_DETAILS_BENEFICIARY = "  Apolles Ltd  ";
    process.env.BANK_DETAILS_IBAN = "   ";
    expect(getBankDetails()).toEqual([{ label: "Beneficiary", value: "Apolles Ltd" }]);
  });

  it("reads the environment on every call (not once at import)", () => {
    expect(getBankDetails()).toEqual([]);
    process.env.BANK_DETAILS_SWIFT = "TESTILIT";
    expect(getBankDetails()).toEqual([{ label: "SWIFT", value: "TESTILIT" }]);
  });
});

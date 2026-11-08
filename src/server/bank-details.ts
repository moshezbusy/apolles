// Apolles' bank account for agency top-ups, shown on the agent balance page.
// Server-only: read from the environment on every request (never NEXT_PUBLIC_*), so a change
// on the host needs no rebuild. A variable that is not set (or blank) is simply not shown.
const FIELDS = [
  ["BANK_DETAILS_BENEFICIARY", "Beneficiary"],
  ["BANK_DETAILS_BANK_NAME", "Bank"],
  ["BANK_DETAILS_ACCOUNT_NUMBER", "Account number"],
  ["BANK_DETAILS_IBAN", "IBAN"],
  ["BANK_DETAILS_SWIFT", "SWIFT"],
] as const;

export type BankDetail = { label: string; value: string };

export function getBankDetails(): BankDetail[] {
  const details: BankDetail[] = [];
  for (const [name, label] of FIELDS) {
    const value = process.env[name]?.trim();
    if (value) details.push({ label, value });
  }
  return details;
}

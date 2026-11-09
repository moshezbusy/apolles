// Display format for money held as integer cents: "USD 1,234.56", negative "-USD 12.34".
// Integer math only: no float division, so no rounding surprises.
export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("formatUsd: cents must be a safe integer");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const fraction = abs % 100;
  const whole = (abs - fraction) / 100; // exact: abs - fraction is a multiple of 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}USD ${grouped}.${String(fraction).padStart(2, "0")}`;
}

// Largest amount a ledger entry can hold (LedgerEntry.amountCents is a Postgres int4).
export const MAX_AMOUNT_CENTS = 2_147_483_647;

// "1,000.00" / "1000.5" / "250" (and "-12.50" when allowNegative) → integer cents.
// Commas are only allowed as correct thousands groups. At most 2 decimals. Zero is never a
// valid amount. Returns null for anything else, or beyond ±2,147,483,647 cents.
// String math only (BigInt on whole digits): never parseFloat / Number on the decimal text.
const USD_TEXT = /^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^-?\d+(\.\d{1,2})?$/;

export function parseUsdToCents(
  text: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!USD_TEXT.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  if (negative && !allowNegative) return null;
  const unsigned = (negative ? trimmed.slice(1) : trimmed).replace(/,/g, "");
  const [whole = "", fraction = ""] = unsigned.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents === BigInt(0) || cents > BigInt(MAX_AMOUNT_CENTS)) return null;
  const value = Number(cents); // exact: at most 2,147,483,647
  return negative ? -value : value;
}

// Money from the supplier (Expedia Rapid returns decimal strings such as "74.97") as integer
// minor units of its own currency. String and BigInt arithmetic only: never parseFloat, never
// rounding (Expedia requirement BP5: "no rounding or currency conversion").

export class InvalidAmount extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmount";
  }
}

export type Money = { minor: number; currency: string };

const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

// ISO 4217 minor units, from the runtime's ICU data (USD 2, JPY 0, KWD 3).
export function currencyExponent(currency: string): number {
  if (!CURRENCY.test(currency)) throw new InvalidAmount(`Invalid currency code: ${JSON.stringify(currency)}`);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new InvalidAmount(`Unknown currency: ${currency}`);
  }
}

export function parseAmount(value: string, currency: string, { allowNegative = false } = {}): Money {
  const exponent = currencyExponent(currency);
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new InvalidAmount(`Invalid amount: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  if (negative && !allowNegative) throw new InvalidAmount(`Negative amount: ${value}`);
  const [whole = "", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (fraction.length > exponent) {
    throw new InvalidAmount(`${value} has more decimals than ${currency} allows (${exponent})`);
  }
  const minorBig = BigInt(whole) * BigInt(10) ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0");
  if (minorBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidAmount(`Amount too large: ${value}`);
  const minor = Number(minorBig);
  return { minor: negative ? -minor : minor, currency };
}

// "USD 1,234.56", "JPY 1,000", "-USD 5.00".
export function formatMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new InvalidAmount("formatMinor: minor must be a safe integer");
  const exponent = currencyExponent(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}${fraction}`;
}

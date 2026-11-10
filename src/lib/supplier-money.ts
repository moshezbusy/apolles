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

// ISO 4217 minor units, from a fixed table in code: the runtime's ICU data differs from ISO
// for some currencies (IDR, HUF, COP report 0 there; ISO says 2) and may change with a Node
// upgrade, which would rescale stored amounts. Every currency not listed here has 2.
const EXPONENT_OVERRIDES: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0,
  UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

// Codes the runtime knows (ISO 4217 active codes); used only to reject unknown ones.
const KNOWN_CODES = new Set(Intl.supportedValuesOf("currency"));

export function currencyExponent(currency: string): number {
  if (!CURRENCY.test(currency)) throw new InvalidAmount(`Invalid currency code: ${JSON.stringify(currency)}`);
  if (!KNOWN_CODES.has(currency) && !(currency in EXPONENT_OVERRIDES)) throw new InvalidAmount(`Unknown currency: ${currency}`);
  return EXPONENT_OVERRIDES[currency] ?? 2;
}

export function parseAmount(value: string, currency: string, { allowNegative = false } = {}): Money {
  const exponent = currencyExponent(currency);
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new InvalidAmount(`Invalid amount: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  if (negative && !allowNegative) throw new InvalidAmount(`Negative amount: ${value}`);
  const [whole = "", rawFraction = ""] = (negative ? value.slice(1) : value).split(".");
  // Extra decimals are accepted only when they are zeros ("1000.00" JPY): no rounding, ever.
  const fraction = rawFraction.length > exponent && /^0+$/.test(rawFraction.slice(exponent)) ? rawFraction.slice(0, exponent) : rawFraction;
  if (fraction.length > exponent) {
    throw new InvalidAmount(`${value} has more decimals than ${currency} allows (${exponent})`);
  }
  const minorBig = BigInt(whole) * BigInt(10) ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0");
  if (minorBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new InvalidAmount(`Amount too large: ${value}`);
  const minor = Number(minorBig);
  return { minor: negative && minor !== 0 ? -minor : minor, currency }; // never -0
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

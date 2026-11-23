/**
 * Money is kept in integer minor units (cents) so no float rounding ever
 * touches a price. Amounts from suppliers arrive as decimal strings and are
 * parsed exactly.
 */
export interface Money {
  /** Integer amount in the currency's minor unit (e.g. cents). */
  minor: number;
  /** ISO 4217 code, upper case. */
  currency: string;
}

const EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, VND: 0, XAF: 0, XOF: 0,
  BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3, LYD: 3, IQD: 3,
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Parse "1234.5" / "1234.50" / "-12" exactly. Throws on anything else. */
export function moneyFromDecimal(value: string | number, currency: string): Money {
  const cur = normalizeCurrency(currency);
  const exp = currencyExponent(cur);
  const str = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new Error(`Invalid money amount: "${value}"`);
  const [, sign, whole, fracRaw = ''] = m;
  let frac = fracRaw;
  if (frac.length > exp) {
    // Only allow extra digits if they are zeros; never silently round a price.
    if (/[^0]/.test(frac.slice(exp))) {
      throw new Error(`Amount "${value}" has more precision than ${cur} allows`);
    }
    frac = frac.slice(0, exp);
  }
  frac = frac.padEnd(exp, '0');
  const minor = Number(`${whole}${frac}`);
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: "${value}"`);
  return { minor: sign ? -minor : minor, currency: cur };
}

export function moneyToDecimal(m: Money): string {
  const exp = currencyExponent(m.currency);
  const neg = m.minor < 0;
  const abs = Math.abs(m.minor).toString().padStart(exp + 1, '0');
  const out = exp === 0 ? abs : `${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
  return neg ? `-${out}` : out;
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), { minor: 0, currency: normalizeCurrency(currency) });
}

/** Negative: a < b, 0: equal, positive: a > b. */
export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minor - b.minor;
}

/** Percent change from `from` to `to` (e.g. 2.5 means +2.5%). */
export function percentChange(from: Money, to: Money): number {
  assertSameCurrency(from, to);
  if (from.minor === 0) return to.minor === 0 ? 0 : Infinity;
  return ((to.minor - from.minor) / Math.abs(from.minor)) * 100;
}

/**
 * True when `current` is above `approved` by more than `maxIncreasePercent`.
 * Whole-number math only: with floats 10000 -> 10700 comes out as
 * 7.000000000000001 % and a 7 % tolerance would wrongly refuse it.
 */
export function exceedsTolerance(approved: Money, current: Money, maxIncreasePercent: number): boolean {
  assertSameCurrency(approved, current);
  if (!Number.isFinite(maxIncreasePercent) || maxIncreasePercent < 0) throw new Error(`Invalid price tolerance: ${maxIncreasePercent}`);
  if (!Number.isSafeInteger(approved.minor) || !Number.isSafeInteger(current.minor)) throw new Error('Money amounts must be whole minor units');
  if (current.minor <= approved.minor) return false;
  // Percent with up to 4 decimals as a whole number (7 % -> 70000), then compare cross-multiplied.
  const SCALE = 10_000n;
  const pct = BigInt(Math.round(maxIncreasePercent * Number(SCALE)));
  const increase = BigInt(current.minor) - BigInt(approved.minor);
  const base = BigInt(Math.abs(approved.minor));
  return increase * 100n * SCALE > pct * base;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

function normalizeCurrency(c: string): string {
  const cur = c.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`Invalid currency code: "${c}"`);
  return cur;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid money amount: ${n}`);
  // toFixed(6) then strip zeros avoids exponent notation for normal prices.
  return n.toFixed(6).replace(/\.?0+$/, '');
}

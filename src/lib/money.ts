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

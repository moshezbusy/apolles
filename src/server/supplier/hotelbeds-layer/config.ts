// Settings of the second supplier (Hotelbeds, through the supplier layer service) and of the
// temporary currency conversion. Kept free of imports, like src/server/startup-check.ts, which
// uses these checks when the server starts. Messages name variables only, never a value.
//
// SUPPLIERS: which suppliers search and book, e.g. "expedia,hotelbeds" or "fake,hotelbeds".
// Unset: the main supplier only (Expedia, or the fake by SUPPLIER_MODE), exactly as before.
// Exactly one main supplier ("expedia" or "fake"); "hotelbeds" may be added to it.

export type Env = Record<string, string | undefined>;

export type SupplierList = { main: "expedia" | "fake" | null; hotelbeds: boolean };

const KNOWN = new Set(["expedia", "fake", "hotelbeds"]);

export function readSupplierList(env: Env): SupplierList {
  const raw = (env.SUPPLIERS ?? "").trim();
  if (raw === "") return { main: null, hotelbeds: false };
  const names = raw.split(",").map((name) => name.trim().toLowerCase());
  if (names.some((name) => !KNOWN.has(name)) || new Set(names).size !== names.length) {
    throw new Error('SUPPLIERS must list "expedia" or "fake", optionally with "hotelbeds", separated by commas');
  }
  const mains = names.filter((name) => name === "expedia" || name === "fake");
  if (mains.length !== 1) throw new Error('SUPPLIERS must name exactly one main supplier: "expedia" or "fake"');
  return { main: mains[0] as "expedia" | "fake", hotelbeds: names.includes("hotelbeds") };
}

// ---------- the supplier layer ----------

// Test or production side of Hotelbeds. A production deployment accepts only production answers;
// every other deployment (staging, development, tests) accepts only test answers, so a staging
// booking can never become a real reservation, and production never sells a test rate.
export type LayerEnvironment = "test" | "production";

export type LayerConfig = { baseUrl: string; apiKey: string; environment: LayerEnvironment };

const MIN_KEY_LENGTH = 24; // what the layer itself requires

export function layerEnvironment(env: Env): LayerEnvironment {
  return env.APP_ENV === "production" ? "production" : "test";
}

// Every reason the layer settings cannot be used. Empty = fine.
export function layerConfigProblems(env: Env): string[] {
  const problems: string[] = [];
  const url = (env.SUPPLIER_LAYER_URL ?? "").trim();
  if (url === "") problems.push("SUPPLIER_LAYER_URL is not set (the supplier layer address, e.g. http://apolles-suppliers:8080).");
  else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
      problems.push("SUPPLIER_LAYER_URL must be a plain http:// or https:// address without a query.");
    }
  }
  if ((env.SUPPLIER_LAYER_API_KEY ?? "").trim().length < MIN_KEY_LENGTH) {
    problems.push(`SUPPLIER_LAYER_API_KEY is not set or shorter than ${MIN_KEY_LENGTH} characters.`);
  }
  return problems;
}

export function readLayerConfig(env: Env): LayerConfig {
  const problems = layerConfigProblems(env);
  if (problems.length > 0) throw new Error(problems.join(" "));
  return {
    baseUrl: (env.SUPPLIER_LAYER_URL ?? "").trim().replace(/\/+$/, ""),
    apiKey: (env.SUPPLIER_LAYER_API_KEY ?? "").trim(),
    environment: layerEnvironment(env),
  };
}

// ---------- TEMPORARY: staging-only conversion to USD ----------
// Owner decision 2026-11-23: until Hotelbeds gives a USD-priced account, staging may convert ONE
// other currency (HOTELBEDS_FX_CURRENCY, e.g. EUR) to USD at a fixed rate (HOTELBEDS_FX_TO_USD,
// a decimal string: USD per 1 unit, e.g. "1.0850") plus a safety margin
// (HOTELBEDS_FX_MARGIN_PERCENT, default "2"). Whole-number maths only, always rounded UP (in
// Apolles' favour). Never in production: the server refuses to start with these set there, and
// the conversion refuses to run there. Remove these settings once the USD account exists.

export type FxRule = { currency: string; rateNum: bigint; rateDen: bigint; marginNum: bigint; marginDen: bigint };

const FX_VARIABLES = ["HOTELBEDS_FX_CURRENCY", "HOTELBEDS_FX_TO_USD", "HOTELBEDS_FX_MARGIN_PERCENT"] as const;
// Currencies without 2 decimals are refused: the conversion assumes cents on both sides.
const NOT_TWO_DECIMALS = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF", "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND", "CLF", "UYW"]);
const RATE = /^\d{1,6}(\.\d{1,10})?$/;
const MARGIN = /^\d{1,2}(\.\d{1,4})?$/;
const MAX_MARGIN_PERCENT = 20;

function isSet(env: Env, name: string): boolean {
  return (env[name] ?? "").trim() !== "";
}

export function fxRequested(env: Env): boolean {
  return FX_VARIABLES.some((name) => isSet(env, name));
}

// Production, or a production build that is not staging: the conversion is never allowed there.
function fxForbidden(env: Env): boolean {
  return env.APP_ENV === "production" || (env.NODE_ENV === "production" && env.APP_ENV !== "staging");
}

function decimal(text: string): { num: bigint; den: bigint } {
  const [whole = "0", fraction = ""] = text.split(".");
  const den = BigInt(10) ** BigInt(fraction.length);
  return { num: BigInt(whole) * den + BigInt(fraction || "0"), den };
}

// Every reason the conversion settings cannot be used. Empty = fine (or not asked for).
export function fxProblems(env: Env): string[] {
  if (!fxRequested(env)) return [];
  if (fxForbidden(env)) {
    return ["HOTELBEDS_FX_CURRENCY, HOTELBEDS_FX_TO_USD and HOTELBEDS_FX_MARGIN_PERCENT are a temporary staging-only conversion: never set them in production. Production accepts only USD Hotelbeds rates."];
  }
  const problems: string[] = [];
  const currency = (env.HOTELBEDS_FX_CURRENCY ?? "").trim();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "USD" || NOT_TWO_DECIMALS.has(currency)) {
    problems.push("HOTELBEDS_FX_CURRENCY must be a 3-letter currency code with 2 decimals other than USD, e.g. EUR.");
  }
  const rate = (env.HOTELBEDS_FX_TO_USD ?? "").trim();
  if (!RATE.test(rate) || decimal(rate).num === BigInt(0)) problems.push('HOTELBEDS_FX_TO_USD must be a decimal number above 0: USD for 1 unit of HOTELBEDS_FX_CURRENCY, e.g. "1.0850".');
  const margin = (env.HOTELBEDS_FX_MARGIN_PERCENT ?? "").trim();
  if (margin !== "" && (!MARGIN.test(margin) || Number(margin) > MAX_MARGIN_PERCENT)) {
    problems.push(`HOTELBEDS_FX_MARGIN_PERCENT must be a number from 0 to ${MAX_MARGIN_PERCENT} (default 2).`);
  }
  return problems;
}

// null: no conversion asked for. Throws when the settings are wrong, or in production.
export function readFxRule(env: Env): FxRule | null {
  if (!fxRequested(env)) return null;
  const problems = fxProblems(env);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const rate = decimal((env.HOTELBEDS_FX_TO_USD ?? "").trim());
  const margin = decimal((env.HOTELBEDS_FX_MARGIN_PERCENT ?? "").trim() || "2");
  return { currency: (env.HOTELBEDS_FX_CURRENCY ?? "").trim(), rateNum: rate.num, rateDen: rate.den, marginNum: margin.num, marginDen: margin.den };
}

// minor (cents of rule.currency) → USD cents: minor × rate × (100 + margin) / 100, rounded up.
// Checked again here: never in production, whatever the caller read before. null: the amount
// cannot be converted (negative, too large).
export function convertToUsdMinor(minor: number, rule: FxRule, env: Env): number | null {
  if (fxForbidden(env)) throw new Error("The temporary Hotelbeds currency conversion is not allowed in production");
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  const hundred = BigInt(100);
  const numerator = BigInt(minor) * rule.rateNum * (hundred * rule.marginDen + rule.marginNum);
  const denominator = rule.rateDen * hundred * rule.marginDen;
  const usd = (numerator + denominator - BigInt(1)) / denominator;
  return usd <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(usd) : null;
}

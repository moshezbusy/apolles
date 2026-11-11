import type { ListOptions } from "./search";

// The results page keeps its filters in the URL (a plain GET form), so they survive a reload
// and work without JavaScript. Every value is read on the server: anything unreadable is
// dropped, never an error. Prices are typed in USD and become cents with integer math.

type Params = Record<string, string | string[] | undefined>;

const SORTS = new Set<ListOptions["sort"]>(["recommended", "price_asc", "price_desc", "stars_desc"]);
const MAX_PRICE_MINOR = 100_000_000; // USD 1,000,000

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function text(value: string | string[] | undefined): string | undefined {
  const trimmed = one(value)?.trim().slice(0, 100);
  return trimmed ? trimmed : undefined;
}

// "250", "250.5", "250.50" → cents. Anything else (negative, exponent, 3 decimals) → undefined.
export function usdToMinor(value: string | string[] | undefined): number | undefined {
  const raw = one(value)?.trim();
  const match = raw?.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return undefined;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor <= MAX_PRICE_MINOR ? minor : undefined;
}

export function parseListOptions(params: Params): ListOptions {
  const sort = one(params.sort) as ListOptions["sort"] | undefined;
  const options: ListOptions = { sort: sort && SORTS.has(sort) ? sort : "recommended" };
  const name = text(params.name);
  if (name) options.name = name;
  const roomName = text(params.room);
  if (roomName) options.roomName = roomName;
  const min = usdToMinor(params.min);
  if (min !== undefined) options.minPriceMinor = min;
  const max = usdToMinor(params.max);
  if (max !== undefined) options.maxPriceMinor = max;
  const rawStars = params.stars === undefined ? [] : Array.isArray(params.stars) ? params.stars : [params.stars];
  const stars = [...new Set(rawStars.filter((s) => /^[1-5]$/.test(s)).map(Number))].sort();
  if (stars.length > 0) options.stars = stars;
  if (one(params.free) === "1") options.freeCancellation = true;
  const cursor = one(params.cursor);
  if (cursor && /^\d{1,6}$/.test(cursor)) options.cursor = cursor;
  return options;
}

// Cents → "250", "250.5" style text for the filter box, with integer math (no float division).
export function minorToUsdText(minor: number): string {
  const cents = minor % 100;
  const whole = (minor - cents) / 100;
  if (cents === 0) return String(whole);
  return `${whole}.${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

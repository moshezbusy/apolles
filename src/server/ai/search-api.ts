import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { isCountryCode } from "@/lib/countries";
import { currencyExponent, type Money } from "@/lib/supplier-money";
import { audit } from "@/server/audit";
import type { getContent } from "@/server/content/content-cache";
import { getClientIp } from "@/server/client-ip";
import { db } from "@/server/db";
import { hitRateLimit } from "@/server/rate-limit";
import { destinationById, suggestDestinations } from "@/server/search/destinations";
import { SearchInputInvalid, SearchRateLimited, SearchUnavailable } from "@/server/search/errors";
import { getHotelOffers, listResults, searchSummary, startSearch, type HotelCard, type ListOptions } from "@/server/search/search";
import type { Occupancy, Offer, SupplierAdapter } from "@/server/supplier/types";
import { mcpResource, serviceKeyMatches } from "./config";
import { hotelLink } from "./links";
import { verifyAiToken } from "./tokens";

// The internal AI search API (plan 11, design §5 and §7): the only way the separate MCP server
// reaches Apolles. Search only: it starts and reads searches of the token's own agency and never
// touches bookings, money or clients. Checks, in this order, on every call:
//   1. per-IP ceiling (before anything else is looked at),
//   2. the MCP server's own service key (no token lookup without it),
//   3. the agent's search token (read from the database every time: a revoke or a suspension
//      stops the very next call),
//   4. the agent's tool-call limits (per minute and per day),
//   5. the request body (strict),
//   6. the work.
// Every call that passed 1-3 writes one audit row: the agent, the connection and the outcome;
// never the token, the IP or text from the request.

export type AiAuth = { serviceKey: string | null; bearer: string | null; ip: string };
export type ApiResult = { status: 200 | 400 | 401 | 403 | 404 | 429 | 503; json: unknown };
// Tests inject the supplier, the content source and the clock; production passes nothing.
export type AiDeps = { adapter?: SupplierAdapter; content?: typeof getContent; now?: Date };

type Caller = { connectionId: string; userId: string; agencyId: string };
type Outcome = "ok" | "rate_limited" | "invalid" | "unavailable" | "not_found" | "ambiguous";

const IP_LIMIT = { limit: 600, windowMs: 60_000 };
// Per agent, every tool call. The day bucket has its own key: buckets are rows keyed by
// (key, window start), and at midnight UTC a minute window and the day window start together.
const AGENT_LIMITS = [
  { suffix: "", limit: 20, windowMs: 60_000 },
  { suffix: ":day", limit: 500, windowMs: 86_400_000 },
] as const;
const MAX_RATES = 30;
const MAX_AMENITIES = 10;
const MAX_CANDIDATES = 5;
const SUGGESTIONS = 6;
const USER_AGENT = "Apolles AI search";

const SEARCH_MESSAGE = "Check the destination, dates and guests.";
const EXPIRED_MESSAGE = "This search expired. Run search_hotels again.";
const NOTES = ["Prices are checked again before booking. Book in Apolles.", "Nationality does not change the price; the agency's country is used."];
const BED_TYPE_NOTE = "Bed type is a request and not guaranteed";
// Kinds of price line that are taxes or fees (the rest are the room itself, extra persons and discounts).
const TAX_KINDS = new Set(["taxes_and_fees", "taxes", "service_fee"]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const country = z.string().refine(isCountryCode);

const searchSchema = z
  .object({
    destination: z.string().trim().min(2).max(60).optional(),
    destination_id: z.string().regex(ID).optional(),
    checkin: z.string().regex(DATE),
    checkout: z.string().regex(DATE),
    rooms: z
      .array(
        z
          .object({
            adults: z.number().int().min(1).max(8),
            child_ages: z.array(z.number().int().min(0).max(17)).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    nationality: country,
    max_results: z.number().int().min(1).max(20).default(10),
    sort: z.enum(["recommended", "price_asc", "stars_desc"]).default("recommended"),
    min_stars: z.number().int().min(0).max(5).optional(),
    free_cancellation_only: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.destination === undefined) !== (b.destination_id === undefined), { path: ["destination"] });

const ratesSchema = z
  .object({ search_id: z.string().regex(ID), hotel_id: z.string().regex(ID), nationality: country.optional() })
  .strict();

const result = (status: ApiResult["status"], json: unknown): ApiResult => ({ status, json });
const invalid = (message: string) => result(400, { error: "invalid_request", message });
const RATE_LIMITED = { error: "rate_limited", message: "Too many requests from this assistant. Wait a minute and try again." };

// A plain message for the assistant, without echoing anything it sent.
function messageOf(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return SEARCH_MESSAGE;
  if (issue.path.length === 0 && issue.code !== "unrecognized_keys") return "The request body must be a JSON object.";
  if (issue.code === "unrecognized_keys") return "The request has a field this tool does not take.";
  const field = issue.path[0];
  if (field === "nationality") return "nationality must be an ISO 3166 country code in capitals, e.g. IL.";
  if (field === "destination" && issue.code !== "custom") return "destination must be 2 to 60 characters.";
  if (field === "destination" || field === "destination_id") return "Give either destination or destination_id.";
  if (field === "search_id" || field === "hotel_id") return "Give the search_id and hotel_id from search_hotels.";
  return SEARCH_MESSAGE;
}

// "1234.56" in the currency's own minor units (2 for USD). Integer and string math only.
function amount(m: Money): { amount: string; currency: string } {
  const exponent = currencyExponent(m.currency);
  const digits = String(Math.abs(m.minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(-exponent)}` : "";
  return { amount: `${m.minor < 0 ? "-" : ""}${whole}${fraction}`, currency: m.currency };
}

function stars(starRating: string | null): number | null {
  if (starRating === null) return null;
  const value = Number(starRating);
  return Number.isFinite(value) ? value : null;
}

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}

const roomsOut = (rooms: Occupancy[]) => rooms.map((r) => ({ adults: r.adults, child_ages: r.childAges }));

// Steps 1-4. `deny` is the answer when a check fails; a caller means steps 1-3 passed (and the
// agent's limit may still have refused: then the call is audited as rate_limited).
async function authenticate(auth: AiAuth): Promise<{ deny: ApiResult } | { caller: Caller; limited: boolean }> {
  const ip = await hitRateLimit(`ai-api:ip:${auth.ip}`, IP_LIMIT.limit, IP_LIMIT.windowMs);
  if (!ip.allowed) return { deny: result(429, { error: "rate_limited" }) };
  if (!serviceKeyMatches(auth.serviceKey)) return { deny: result(401, { error: "unauthorized" }) };
  const caller = auth.bearer === null ? null : await verifyAiToken(auth.bearer, mcpResource());
  if (!caller) return { deny: result(401, { error: "invalid_token" }) };
  for (const { suffix, limit, windowMs } of AGENT_LIMITS) {
    const hit = await hitRateLimit(`ai:user:${caller.userId}${suffix}`, limit, windowMs);
    if (!hit.allowed) return { caller, limited: true };
  }
  return { caller, limited: false };
}

type AuditFields = { destination_id?: string; checkin?: string; checkout?: string; rooms?: number; results?: number; outcome: Outcome };

async function record(caller: Caller, action: "ai.search_hotels" | "ai.get_hotel_rates", after: AuditFields): Promise<void> {
  await audit(caller.userId, action, "AiConnection", caller.connectionId, undefined, after as Prisma.InputJsonValue);
}

// A search-service error as an answer; anything else is a bug and goes up.
function searchErrorResult(error: unknown): { res: ApiResult; outcome: Outcome } {
  if (error instanceof SearchInputInvalid) return { res: invalid(error.message), outcome: "invalid" };
  if (error instanceof SearchRateLimited) return { res: result(429, { error: "rate_limited", message: error.message }), outcome: "rate_limited" };
  if (error instanceof SearchUnavailable) return { res: result(503, { error: "unavailable", message: error.message }), outcome: "unavailable" };
  throw error;
}

type Resolved = { destination: { id: string; label: string } } | { res: ApiResult; outcome: Outcome };

// destination_id → that destination. Text → the search box's suggestions: one exact name match,
// or one suggestion only, is used; several → candidates and no search ("San Jose").
async function resolveDestination(body: z.infer<typeof searchSchema>): Promise<Resolved> {
  if (body.destination_id !== undefined) {
    const found = await destinationById(body.destination_id);
    return found ? { destination: found } : { res: invalid("No destination has that destination_id."), outcome: "invalid" };
  }
  const text = (body.destination ?? "").toLowerCase();
  const suggestions = await suggestDestinations(text, SUGGESTIONS);
  if (suggestions.length === 0) return { res: invalid("No destination matches that name."), outcome: "invalid" };
  if (suggestions.length === 1) return { destination: suggestions[0]! };
  const names = await db.destination.findMany({ where: { id: { in: suggestions.map((s) => s.id) } }, select: { id: true, name: true } });
  const nameOf = new Map(names.map((n) => [n.id, n.name.toLowerCase()]));
  const exact = suggestions.filter((s) => s.label.toLowerCase() === text || nameOf.get(s.id) === text);
  if (exact.length === 1) return { destination: exact[0]! };
  return {
    res: result(200, {
      candidates: suggestions.slice(0, MAX_CANDIDATES).map((s) => ({ destination_id: s.id, name: s.label, type: s.type })),
      message: "Several places match. Call again with destination_id.",
    }),
    outcome: "ambiguous",
  };
}

export async function aiSearch(auth: AiAuth, body: unknown, deps: AiDeps = {}): Promise<ApiResult> {
  const checked = await authenticate(auth);
  if ("deny" in checked) return checked.deny;
  const { caller } = checked;
  const action = "ai.search_hotels";
  if (checked.limited) {
    await record(caller, action, { outcome: "rate_limited" });
    return result(429, RATE_LIMITED);
  }
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    await record(caller, action, { outcome: "invalid" });
    return invalid(messageOf(parsed.error));
  }
  const input = parsed.data;
  const rooms: Occupancy[] = input.rooms.map((r) => ({ adults: r.adults, childAges: r.child_ages }));
  const base = { checkin: input.checkin, checkout: input.checkout, rooms: rooms.length };

  const resolved = await resolveDestination(input);
  if ("res" in resolved) {
    await record(caller, action, { ...base, outcome: resolved.outcome });
    return resolved.res;
  }
  const { destination } = resolved;
  const fields = { destination_id: destination.id, ...base };
  const now = deps.now ?? new Date();

  let snapshotId: string;
  let listed: Awaited<ReturnType<typeof listResults>>;
  try {
    ({ snapshotId } = await startSearch(
      { agencyId: caller.agencyId, userId: caller.userId, supplierContext: { userAgent: USER_AGENT } },
      { destinationId: destination.id, checkin: input.checkin, checkout: input.checkout, rooms },
      { source: "AI", now, ...(deps.adapter ? { adapter: deps.adapter } : {}), ...(deps.content ? { content: deps.content } : {}) },
    ));
    const opts: ListOptions = { sort: input.sort, take: input.max_results };
    if (input.min_stars !== undefined && input.min_stars > 0) opts.stars = [0, 1, 2, 3, 4, 5].filter((s) => s >= input.min_stars!);
    if (input.free_cancellation_only) opts.freeCancellation = true;
    listed = await listResults(caller.agencyId, snapshotId, opts, now);
  } catch (error) {
    const { res, outcome } = searchErrorResult(error);
    await record(caller, action, { ...fields, outcome });
    return res;
  }
  if (!listed) throw new Error("aiSearch: the new search was not found");

  const hotels = listed.hotels.map((card: HotelCard) => ({
    hotel_id: card.propertyId,
    name: card.name,
    city: card.city,
    stars: stars(card.starRating),
    cheapest_total: amount(card.minTotal),
    free_cancellation_available: card.refundableAvailable,
    fees_at_hotel: card.feesAtProperty,
    other_rates: card.best?.otherRates ?? 0,
    link: hotelLink({
      hotelName: card.name,
      propertyId: card.propertyId,
      destinationId: destination.id,
      checkin: input.checkin,
      checkout: input.checkout,
      rooms,
      nationality: input.nationality,
    }),
  }));
  await record(caller, action, { ...fields, results: hotels.length, outcome: "ok" });
  return result(200, {
    search_id: snapshotId,
    destination: { destination_id: destination.id, name: destination.label },
    nights: nightsBetween(input.checkin, input.checkout),
    total_hotels: listed.total,
    hotels,
    notes: NOTES,
  });
}

function taxesAndFees(offer: Offer): { amount: string; currency: string } | null {
  const lines = offer.price.lines.filter((l) => TAX_KINDS.has(l.kind));
  if (lines.length === 0) return null;
  const currency = offer.price.total.currency;
  if (lines.some((l) => l.amount.currency !== currency)) return null;
  const sum = lines.reduce((n, l) => n + l.amount.minor, 0);
  return Number.isSafeInteger(sum) ? amount({ minor: sum, currency }) : null;
}

// Free cancellation ends where the first charge starts (as the hotel page says it).
function freeCancellationUntil(offer: Offer): string | null {
  if (!offer.refundable) return null;
  const first = [...offer.cancelPenalties].sort((x, y) => x.start.localeCompare(y.start))[0];
  return first?.start ?? null;
}

function rateOut(offer: Offer) {
  return {
    room_name: offer.roomName,
    bed_types: offer.bedGroups.map((b) => b.description),
    bed_type_note: BED_TYPE_NOTE,
    refundable: offer.refundable,
    free_cancellation_until: freeCancellationUntil(offer),
    total: amount(offer.price.total),
    taxes_and_fees: taxesAndFees(offer),
    fees_at_hotel: offer.price.dueAtProperty.map((d) => ({
      kind: d.kind,
      amount: amount(d.amount),
      local_amount: d.localAmount ? amount(d.localAmount) : null,
    })),
    // The supplier's own name never reaches an assistant (GR1).
    amenities: offer.amenities.filter((a) => !/expedia/i.test(a)).slice(0, MAX_AMENITIES),
  };
}

export async function aiRates(auth: AiAuth, body: unknown, deps: AiDeps = {}): Promise<ApiResult> {
  const checked = await authenticate(auth);
  if ("deny" in checked) return checked.deny;
  const { caller } = checked;
  const action = "ai.get_hotel_rates";
  if (checked.limited) {
    await record(caller, action, { outcome: "rate_limited" });
    return result(429, RATE_LIMITED);
  }
  const parsed = ratesSchema.safeParse(body);
  if (!parsed.success) {
    await record(caller, action, { outcome: "invalid" });
    return invalid(messageOf(parsed.error));
  }
  const input = parsed.data;
  const now = deps.now ?? new Date();

  let found: Awaited<ReturnType<typeof getHotelOffers>>;
  try {
    // The answer uses no hotel content (photos, policies), so none is loaded for it.
    found = await getHotelOffers(caller.agencyId, input.search_id, input.hotel_id, now, { content: deps.content ?? (async () => new Map()) });
  } catch (error) {
    const { res, outcome } = searchErrorResult(error);
    await record(caller, action, { outcome });
    return res;
  }
  // Expired, unknown, another agency's search or a hotel not in it: one answer for all.
  const summary = found ? await searchSummary(caller.agencyId, input.search_id, now) : null;
  if (!found || !summary || summary.expired) {
    await record(caller, action, { outcome: "not_found" });
    return result(404, { error: "not_found", message: EXPIRED_MESSAGE });
  }

  let nationality = input.nationality;
  if (nationality === undefined) {
    const agency = await db.agency.findUnique({ where: { id: caller.agencyId }, select: { country: true } });
    nationality = agency && isCountryCode(agency.country) ? agency.country : "US";
  }
  // Cheapest first; equal prices keep the supplier's order.
  const rates = found.offers
    .map((offer, index) => ({ offer, index }))
    .sort((x, y) => x.offer.price.total.minor - y.offer.price.total.minor || x.index - y.index)
    .slice(0, MAX_RATES)
    .map(({ offer }) => rateOut(offer));

  await record(caller, action, {
    destination_id: summary.destinationId,
    checkin: summary.checkin,
    checkout: summary.checkout,
    rooms: summary.rooms.length,
    results: rates.length,
    outcome: "ok",
  });
  return result(200, {
    search_id: input.search_id,
    hotel: { hotel_id: input.hotel_id, name: found.hotel.name, city: found.hotel.city, stars: stars(found.hotel.starRating) },
    stay: { checkin: summary.checkin, checkout: summary.checkout, nights: summary.nights, rooms: roomsOut(summary.rooms) },
    rates,
    link: hotelLink({
      hotelName: found.hotel.name,
      propertyId: input.hotel_id,
      destinationId: summary.destinationId,
      checkin: summary.checkin,
      checkout: summary.checkout,
      rooms: summary.rooms,
      nationality,
    }),
  });
}

// ---------- HTTP plumbing for the two routes under src/app/api/ai/v1/ ----------

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
// Not valid input for either tool: the body checks answer 400 (after the caller checks).
const UNREADABLE = Symbol("unreadable body");

// The body as JSON, read up to 16 KB; anything larger or not JSON is UNREADABLE.
async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return UNREADABLE;
  if (!request.body) return UNREADABLE;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return UNREADABLE;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    return UNREADABLE;
  }
}

function bearerOf(header: string | null): string | null {
  const match = header?.match(/^Bearer +([^\s]+)$/i);
  return match ? match[1]! : null;
}

export function aiNotFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

export function aiMethodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}

// The service key comes from the MCP server; the token is the agent's, forwarded by it. A
// session cookie is never read here.
export async function handleAiRequest(
  request: Request,
  handler: (auth: AiAuth, body: unknown) => Promise<ApiResult>,
): Promise<Response> {
  const auth: AiAuth = {
    serviceKey: request.headers.get("x-apolles-service-key"),
    bearer: bearerOf(request.headers.get("authorization")),
    ip: getClientIp(request.headers),
  };
  try {
    const body = await readJson(request);
    const { status, json } = await handler(auth, body);
    return Response.json(json, { status, headers: NO_STORE });
  } catch (error) {
    console.error(`ai api failed: ${error instanceof Error ? error.name : "Error"}`);
    return Response.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}

import { createHash } from 'node:crypto';
import { SupplierError, type SupplierErrorCode } from '../../core/errors.js';
import { currencyExponent, moneyFromDecimal, type Money } from '../../core/money.js';
import type {
  BookingLookup,
  CallContext,
  SupplierAdapter,
  SupplierBookingResult,
  SupplierBookRequest,
  SupplierCancelResult,
  SupplierCapabilities,
  SupplierOffer,
  SupplierQuote,
  SupplierSearchRequest,
} from '../../core/supplier.js';
import type { BoardCode, CancellationPenalty, Occupancy, RateOffer } from '../../core/types.js';
import type { HttpResponse, HttpTransport } from '../../http/transport.js';
import type { SecretProvider } from '../../security/secrets.js';

/**
 * Hotelbeds APItude Booking API (hotel-api 1.0, JSON).
 * Flow: Availability (POST /hotels) -> CheckRate (POST /checkrates)
 *       -> Booking (POST /bookings) -> detail / list / cancel.
 * Auth: Api-key header + X-Signature = sha256(apiKey + secret + unix seconds).
 */
export interface HotelbedsAdapterConfig {
  id: string;
  /** Test: https://api.test.hotelbeds.com/hotel-api/1.0 */
  baseUrl: string;
  environment: 'test' | 'production';
  /** Hotelbeds certifies the integration before issuing a live key. */
  certified: boolean;
  transport: HttpTransport;
  /** Env var NAMES of the API key and secret. */
  secretNames: { apiKey: string; secret: string };
  secrets: SecretProvider;
  /** Clock, for the signature (tests). */
  now?: () => Date;
}

const TIMEOUTS = { search: 20_000, checkRate: 20_000, book: 60_000, detail: 20_000, cancel: 60_000 };

/** Hotelbeds clientReference max length. */
export const HB_CLIENT_REF_MAX = 20;

const BOARD: Record<string, BoardCode> = {
  RO: 'RO',
  BB: 'BB',
  CB: 'BB',
  AB: 'BB',
  HB: 'HB',
  FB: 'FB',
  AI: 'AI',
};

// ------------------------------------------------------------- wire types

interface HbTax { included?: boolean; amount?: string | number; currency?: string; type?: string }
interface HbCancelPolicy { amount?: string | number; from?: string }
interface HbRate {
  rateKey?: string;
  rateClass?: string;
  rateType?: string;
  net?: string | number;
  paymentType?: string;
  boardCode?: string;
  boardName?: string;
  rooms?: number;
  adults?: number;
  children?: number;
  childrenAges?: string;
  cancellationPolicies?: HbCancelPolicy[];
  taxes?: { allIncluded?: boolean; taxes?: HbTax[] };
  rateComments?: string;
  promotions?: { name?: string }[];
  offers?: { name?: string }[];
}
interface HbRoom { code?: string; name?: string; status?: string; rates?: HbRate[] }
interface HbHotel { code?: number | string; name?: string; currency?: string; rooms?: HbRoom[]; totalNet?: string | number }
interface HbError { code?: string; message?: string }
interface HbBooking {
  reference?: string;
  clientReference?: string;
  status?: string;
  cancellationReference?: string;
  totalNet?: string | number;
  currency?: string;
  hotel?: HbHotel & { cancellationAmount?: string | number };
}

/** One occupancy group = identical rooms, sent to Hotelbeds as one occupancy line. */
interface Group {
  adults: number;
  childrenAges: number[];
  /** Indexes into the search rooms[]. */
  indexes: number[];
}

/** Stored in supplierData.lines (JSON): one rate per occupancy group. */
interface Line {
  rateKey: string;
  rateType: string;
  indexes: number[];
}

interface FlatRate { room: HbRoom; rate: HbRate }

export class HotelbedsAdapter implements SupplierAdapter {
  readonly id: string;
  readonly capabilities: SupplierCapabilities = {
    multiRoom: true,
    maxHotelsPerSearch: 100,
    nativeCheckRate: true,
    lookupByClientReference: true,
    cancel: true,
    reconcileAfterMs: 30_000,
  };

  constructor(private readonly cfg: HotelbedsAdapterConfig) {
    if (cfg.environment === 'production' && !cfg.certified) {
      throw new Error(`${cfg.id}: Hotelbeds certification not signed off; production is blocked`);
    }
    this.id = cfg.id;
  }

  // ------------------------------------------------------------- search

  async search(req: SupplierSearchRequest, ctx: CallContext): Promise<SupplierOffer[]> {
    const codes = req.supplierHotelCodes.map((c) => Number(c)).filter((n) => Number.isInteger(n) && n > 0);
    if (!codes.length) return [];
    const groups = groupRooms(req.rooms);
    const body: Record<string, unknown> = {
      stay: { checkIn: req.checkIn, checkOut: req.checkOut },
      occupancies: groups.map(toOccupancy),
      hotels: { hotel: codes },
    };
    if (req.nationality) body['sourceMarket'] = req.nationality;
    const res = await this.call<{ hotels?: { hotels?: HbHotel[] }; error?: HbError }>('search', 'POST', '/hotels', body, TIMEOUTS.search, ctx, true);
    if (res.status >= 400) throw this.error(res, 'search');
    const nights = nightsBetween(req.checkIn, req.checkOut);
    return (res.json.hotels?.hotels ?? []).flatMap((h) => this.hotelOffers(h, groups, nights));
  }

  // ---------------------------------------------------------- checkRate

  async checkRate(offer: RateOffer, ctx: CallContext): Promise<SupplierQuote> {
    const lines = readLines(offer, this.id);
    const res = await this.call<{ hotel?: HbHotel; error?: HbError }>(
      'checkRate', 'POST', '/checkrates', { rooms: lines.map((l) => ({ rateKey: l.rateKey })) }, TIMEOUTS.checkRate, ctx, true,
    );
    if (res.status >= 400) {
      const err = this.error(res, 'checkRate');
      if (err.code === 'SOLD_OUT' || err.code === 'RATE_CHANGED') return { available: false };
      throw err;
    }
    const hotel = res.json.hotel;
    if (!hotel) return { available: false };
    const groups = groupRooms(offer.occupancy);
    const flat = flatten(hotel);
    const picked = groups.map((g) => flat.find((f) => matchesGroup(f.rate, g)) ?? (groups.length === 1 ? flat[0] : undefined));
    if (picked.some((p) => !p) || picked.length !== groups.length) return { available: false };
    // Hotelbeds: CheckRate policy, comments and (possibly new) rateKey are the ones to book with.
    const fresh = this.buildOffer(hotel, groups, picked as FlatRate[], nightsBetween(offer.checkIn, offer.checkOut));
    return fresh ? { available: true, offer: fresh } : { available: false };
  }

  // --------------------------------------------------------------- book

  async book(req: SupplierBookRequest, ctx: CallContext): Promise<SupplierBookingResult> {
    if (req.payment.type !== 'AGENCY_CREDIT') {
      throw new SupplierError(this.id, 'VALIDATION', 'book: only agency credit (AT_WEB) is enabled for Hotelbeds');
    }
    if (req.offer.paymentModel === 'PAY_AT_HOTEL') {
      throw new SupplierError(this.id, 'VALIDATION', 'book: pay-at-hotel rates are not enabled for Hotelbeds');
    }
    if (req.clientReference.length > HB_CLIENT_REF_MAX) {
      throw new SupplierError(this.id, 'VALIDATION', `book: clientReference longer than ${HB_CLIENT_REF_MAX} chars (Hotelbeds limit)`);
    }
    const lines = readLines(req.offer, this.id);
    const rooms = lines.map((l) => ({
      rateKey: l.rateKey,
      paxes: l.indexes.flatMap((roomIdx, pos) =>
        (req.guests[roomIdx] ?? []).map((g) => ({
          roomId: pos + 1,
          type: g.type === 'CHILD' ? 'CH' : 'AD',
          ...(g.type === 'CHILD' ? { age: g.age } : {}),
          name: g.firstName,
          surname: g.lastName,
        })),
      ),
    }));
    const body: Record<string, unknown> = {
      holder: { name: req.holder.firstName, surname: req.holder.lastName },
      rooms,
      clientReference: req.clientReference,
      tolerance: 0,
    };
    if (req.specialRequests) body['remark'] = req.specialRequests;

    const res = await this.call<{ booking?: HbBooking; error?: HbError }>('book', 'POST', '/bookings', body, TIMEOUTS.book, ctx, false);
    if (res.status >= 400) {
      // A 4xx with an error body is a definite "not booked"; anything else stays unknown.
      if (res.json.error && res.status < 500) throw this.error(res, 'book');
      throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', `book: HTTP ${res.status} without a readable error`);
    }
    const b = res.json.booking;
    if (!b?.reference) throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'book: success without booking reference');
    return this.toResult(b) ?? { status: 'CONFIRMED', supplierBookingRef: b.reference, total: req.offer.total };
  }

  // --------------------------------------------------------- getBooking

  async getBooking(ref: BookingLookup, ctx: CallContext): Promise<SupplierBookingResult | null> {
    if (ref.supplierBookingRef) {
      const res = await this.call<{ booking?: HbBooking; error?: HbError }>(
        'getBooking', 'GET', `/bookings/${encodeURIComponent(ref.supplierBookingRef)}`, undefined, TIMEOUTS.detail, ctx, true,
      );
      if (res.status === 404 || (res.status >= 400 && res.status < 500 && !isAuth(res.status))) return null;
      if (res.status >= 400) throw this.error(res, 'getBooking');
      return res.json.booking ? this.toResult(res.json.booking) : null;
    }
    // After a timeout we only know our own reference: list bookings created around now.
    const now = this.now();
    const qs = new URLSearchParams({
      start: isoDay(new Date(now.getTime() - 7 * 86_400_000)),
      end: isoDay(new Date(now.getTime() + 86_400_000)),
      filterType: 'CREATION',
      clientReference: ref.clientReference,
      includeCancelled: 'true',
      from: '1',
      to: '100',
    });
    const res = await this.call<{ bookings?: { bookings?: HbBooking[] }; error?: HbError }>(
      'getBooking', 'GET', `/bookings?${qs.toString()}`, undefined, TIMEOUTS.detail, ctx, true,
    );
    if (res.status >= 400) throw this.error(res, 'getBooking');
    const match = (res.json.bookings?.bookings ?? []).find((b) => b.clientReference?.toUpperCase() === ref.clientReference.toUpperCase());
    return match ? this.toResult(match) : null;
  }

  // ------------------------------------------------------------- cancel

  async cancel(ref: BookingLookup, ctx: CallContext): Promise<SupplierCancelResult> {
    if (!ref.supplierBookingRef) throw new SupplierError(this.id, 'VALIDATION', 'cancel: Hotelbeds booking reference missing');
    const res = await this.call<{ booking?: HbBooking; error?: HbError }>(
      'cancel', 'DELETE', `/bookings/${encodeURIComponent(ref.supplierBookingRef)}?cancellationFlag=CANCELLATION`, undefined, TIMEOUTS.cancel, ctx, false,
    );
    if (res.status >= 400) {
      if (res.json.error && res.status < 500) return { cancelled: false, message: errText(res.json.error) };
      throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', `cancel: HTTP ${res.status}`);
    }
    const b = res.json.booking;
    if (!b) throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'cancel: empty answer');
    const cancelled = (b.status ?? '').toUpperCase() === 'CANCELLED';
    const feeRaw = b.hotel?.cancellationAmount;
    const currency = b.currency ?? b.hotel?.currency;
    return {
      cancelled,
      cancellationRef: b.cancellationReference ?? b.reference,
      fee: feeRaw !== undefined && currency ? hbMoney(feeRaw, currency) : undefined,
      message: b.status,
    };
  }

  // ------------------------------------------------------------ mapping

  private hotelOffers(h: HbHotel, groups: Group[], nights: number): SupplierOffer[] {
    const flat = flatten(h);
    if (groups.length === 1) {
      return flat.map((f) => this.buildOffer(h, groups, [f], nights)).filter((o): o is SupplierOffer => !!o);
    }
    // Different occupancies: Hotelbeds prices each one separately. Combine the
    // cheapest rate per group for each board + refundability.
    const byKey = new Map<string, FlatRate[][]>();
    for (const f of flat) {
      const gi = groups.findIndex((g) => matchesGroup(f.rate, g));
      if (gi < 0) continue;
      const key = `${f.rate.boardCode ?? ''}|${isNrf(f.rate) ? 'NRF' : 'REF'}|${f.rate.paymentType ?? ''}`;
      const slots = byKey.get(key) ?? groups.map(() => [] as FlatRate[]);
      slots[gi]!.push(f);
      byKey.set(key, slots);
    }
    const out: SupplierOffer[] = [];
    for (const slots of byKey.values()) {
      if (slots.some((s) => !s.length)) continue;
      const picked = slots.map((s) => [...s].sort((a, b) => num(a.rate.net) - num(b.rate.net))[0]!);
      const o = this.buildOffer(h, groups, picked, nights);
      if (o) out.push(o);
    }
    return out;
  }

  private buildOffer(h: HbHotel, groups: Group[], picked: FlatRate[], _nights: number): SupplierOffer | undefined {
    const currency = h.currency?.toUpperCase();
    if (h.code === undefined || !currency) return undefined;
    if (picked.some((p) => !p.rate.rateKey || p.rate.net === undefined)) return undefined;
    let total: Money;
    try {
      total = { minor: picked.reduce((s, p) => s + hbMoney(p.rate.net!, currency).minor, 0), currency };
    } catch {
      return undefined;
    }
    const first = picked[0]!.rate;
    const refundable = picked.every((p) => !isNrf(p.rate));
    const penalties = mergePenalties(picked.map((p) => p.rate), currency);
    if (!refundable && penalties.length === 0) penalties.push({ from: new Date(0).toISOString(), amount: total });
    const payAtHotel = picked.flatMap((p) =>
      (p.rate.taxes?.taxes ?? [])
        .filter((t) => t.included === false && t.amount !== undefined && t.currency)
        .map((t) => hbMoney(t.amount!, t.currency!.toUpperCase())),
    );
    const remarks = [
      ...picked.map((p) => p.rate.rateComments).filter((c): c is string => !!c),
      ...picked.flatMap((p) => [...(p.rate.promotions ?? []), ...(p.rate.offers ?? [])].map((x) => x.name).filter((n): n is string => !!n)),
    ];
    const rooms = groups.flatMap((g, gi) =>
      g.indexes.map((idx) => ({
        occupancyIndex: idx,
        supplierRoomCode: picked[gi]!.room.code ?? 'ROOM',
        roomName: picked[gi]!.room.name ?? picked[gi]!.room.code ?? 'Room',
      })),
    ).sort((a, b) => a.occupancyIndex - b.occupancyIndex);
    const lines: Line[] = picked.map((p, gi) => ({ rateKey: p.rate.rateKey!, rateType: p.rate.rateType ?? 'RECHECK', indexes: groups[gi]!.indexes }));
    const boardRaw = first.boardCode;
    return {
      supplierHotelCode: String(h.code),
      ratePlanCode: lines.map((l) => l.rateKey).join(' + '),
      ratePlanName: [first.boardName, isNrf(first) ? 'Non-refundable' : undefined].filter(Boolean).join(' · ') || undefined,
      rooms,
      board: boardRaw ? BOARD[boardRaw.toUpperCase()] : undefined,
      boardRaw,
      total,
      taxesIncluded: true,
      payAtHotel: payAtHotel.length ? payAtHotel : undefined,
      paymentModel: picked.some((p) => p.rate.paymentType === 'AT_HOTEL') ? 'PAY_AT_HOTEL' : 'PREPAID',
      cancellation: {
        refundable,
        penalties,
        text: picked.some((p) => !p.rate.cancellationPolicies) ? 'Final cancellation policy is confirmed at re-check (CheckRate).' : undefined,
      },
      remarks: remarks.length ? remarks : undefined,
      supplierData: { lines: JSON.stringify(lines), net: picked.map((p) => String(p.rate.net)).join('+') },
    };
  }

  private toResult(b: HbBooking): SupplierBookingResult | null {
    if (!b.reference) return null;
    const status = (b.status ?? '').toUpperCase();
    const roomStatuses = (b.hotel?.rooms ?? []).map((r) => (r.status ?? '').toUpperCase());
    const mapped: SupplierBookingResult['status'] =
      status === 'CANCELLED' ? 'CANCELLED'
        : status === 'CONFIRMED' && !roomStatuses.some((s) => s && s !== 'CONFIRMED') ? 'CONFIRMED'
          : status === 'CONFIRMED' || status === 'PRECONFIRMED' || status === 'ON_REQUEST' || status === 'PENDING' ? 'ON_REQUEST'
            : 'CONFIRMED';
    const currency = b.currency ?? b.hotel?.currency;
    const totalRaw = b.totalNet ?? b.hotel?.totalNet;
    return {
      status: mapped,
      supplierBookingRef: b.reference,
      total: totalRaw !== undefined && currency ? hbMoney(totalRaw, currency.toUpperCase()) : undefined,
      message: b.status,
    };
  }

  // ---------------------------------------------------------- transport

  private async call<T>(
    operation: string, method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, timeoutMs: number, ctx: CallContext, idempotent: boolean,
  ): Promise<{ status: number; json: T }> {
    const apiKey = this.cfg.secrets.get(this.cfg.secretNames.apiKey);
    const secret = this.cfg.secrets.get(this.cfg.secretNames.secret);
    const ts = Math.floor(this.now().getTime() / 1000);
    const headers: Record<string, string> = {
      'api-key': apiKey,
      'x-signature': signature(apiKey, secret, ts),
      accept: 'application/json',
      'accept-encoding': 'gzip',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res: HttpResponse = await this.cfg.transport.send(
      {
        operation, method, url: `${this.cfg.baseUrl.replace(/\/+$/, '')}${path}`, headers,
        body: body === undefined ? undefined : JSON.stringify(body), timeoutMs, idempotent,
        // Hotelbeds echoes the API key back in auditData.internal.
        sensitiveValues: [apiKey, secret],
      },
      ctx,
    );
    try {
      return { status: res.status, json: (res.body ? JSON.parse(res.body) : {}) as T };
    } catch (err) {
      if (!idempotent) throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', `${operation}: invalid JSON (HTTP ${res.status})`, { cause: err });
      throw new SupplierError(this.id, 'PROTOCOL', `${operation}: invalid JSON (HTTP ${res.status})`, { cause: err });
    }
  }

  private error(res: { status: number; json: { error?: HbError } }, operation: string): SupplierError {
    const e = res.json.error;
    const text = errText(e);
    let kind: SupplierErrorCode = 'PROTOCOL';
    if (isAuth(res.status)) kind = 'AUTH';
    else if (res.status === 429) kind = 'RATE_LIMITED';
    else if (res.status >= 500) kind = 'UNAVAILABLE';
    else if (/allotment|not available|no availability|stop ?sales?|sold ?out|no longer|closed/i.test(text)) kind = 'SOLD_OUT';
    else if (/price|rate has changed|rate.*changed/i.test(text)) kind = 'RATE_CHANGED';
    else if (res.status === 404) kind = 'NOT_FOUND';
    else if (res.status >= 400) kind = 'VALIDATION';
    return new SupplierError(this.id, kind, `${operation}: Hotelbeds HTTP ${res.status} ${text}`.trim(), { supplierCode: e?.code });
  }

  private now(): Date {
    return this.cfg.now?.() ?? new Date();
  }
}

// --------------------------------------------------------------- helpers

export function signature(apiKey: string, secret: string, unixSeconds: number): string {
  return createHash('sha256').update(`${apiKey}${secret}${unixSeconds}`).digest('hex');
}

/** Hotelbeds amounts: decimal strings (sometimes numbers). Exact when possible, else round half-up. */
export function hbMoney(value: string | number, currency: string): Money {
  try {
    return moneyFromDecimal(value, currency);
  } catch {
    const exp = currencyExponent(currency);
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Invalid Hotelbeds amount: ${String(value)}`);
    return { minor: Math.round((n + Number.EPSILON) * 10 ** exp), currency: currency.toUpperCase() };
  }
}

export function groupRooms(rooms: Occupancy[]): Group[] {
  const groups: Group[] = [];
  rooms.forEach((r, i) => {
    const ages = [...r.childrenAges].sort((a, b) => a - b);
    const g = groups.find((x) => x.adults === r.adults && x.childrenAges.join(',') === ages.join(','));
    if (g) g.indexes.push(i);
    else groups.push({ adults: r.adults, childrenAges: ages, indexes: [i] });
  });
  return groups;
}

/** Hotelbeds occupancy line: adults/children are totals for all rooms of the line. */
function toOccupancy(g: Group): Record<string, unknown> {
  const n = g.indexes.length;
  const occ: Record<string, unknown> = { rooms: n, adults: g.adults * n, children: g.childrenAges.length * n };
  if (g.childrenAges.length) {
    occ['paxes'] = Array.from({ length: n }, () => g.childrenAges.map((age) => ({ type: 'CH', age }))).flat();
  }
  return occ;
}

function matchesGroup(rate: HbRate, g: Group): boolean {
  const n = g.indexes.length;
  if (rate.rooms !== undefined && rate.rooms !== n) return false;
  if (rate.adults !== undefined && rate.adults !== g.adults * n) return false;
  if (rate.children !== undefined && rate.children !== g.childrenAges.length * n) return false;
  if (rate.childrenAges) {
    const want = Array.from({ length: n }, () => g.childrenAges).flat().sort((a, b) => a - b).join(',');
    const got = rate.childrenAges.split(',').map((s) => Number(s.trim())).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b).join(',');
    if (got && got !== want) return false;
  }
  return true;
}

function flatten(h: HbHotel): FlatRate[] {
  return (h.rooms ?? []).flatMap((room) => (room.rates ?? []).map((rate) => ({ room, rate })));
}

function isNrf(r: HbRate): boolean {
  return (r.rateClass ?? '').toUpperCase() === 'NRF';
}

/**
 * Each rate has its own list of {from, amount} (amount = total charged from
 * that moment). For a combined offer, the charge at each moment is the sum
 * of every rate's charge in force at that moment.
 */
function mergePenalties(rates: HbRate[], currency: string): CancellationPenalty[] {
  const perRate = rates.map((r) =>
    (r.cancellationPolicies ?? [])
      .map((p) => ({ from: isoUtc(p.from), amount: p.amount === undefined ? undefined : hbMoney(p.amount, currency) }))
      .filter((p): p is { from: string; amount: Money } => !!p.from && !!p.amount)
      .sort((a, b) => a.from.localeCompare(b.from)),
  );
  const moments = [...new Set(perRate.flat().map((p) => p.from))].sort();
  return moments
    .map((from) => ({
      from,
      amount: {
        minor: perRate.reduce((s, list) => s + (list.filter((p) => p.from <= from).at(-1)?.amount.minor ?? 0), 0),
        currency,
      },
    }))
    .filter((p) => p.amount.minor > 0);
}

function readLines(offer: Pick<RateOffer, 'supplierData'>, id: string): Line[] {
  const raw = offer.supplierData['lines'];
  try {
    const lines = raw ? (JSON.parse(raw) as Line[]) : [];
    if (lines.length && lines.every((l) => typeof l.rateKey === 'string' && Array.isArray(l.indexes))) return lines;
  } catch {
    /* fall through */
  }
  throw new SupplierError(id, 'VALIDATION', 'offer has no Hotelbeds rateKey');
}

function isoUtc(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function num(v: string | number | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Infinity;
}

function isAuth(status: number): boolean {
  return status === 401 || status === 403;
}

function errText(e: HbError | undefined): string {
  return e ? [e.code, e.message].filter(Boolean).join(': ') : '';
}

import { SupplierError, type SupplierErrorCode } from '../../core/errors.js';
import { currencyExponent, type Money } from '../../core/money.js';
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
import type { BoardCode, CancellationPenalty, CancellationPolicy, Environment, RateOffer } from '../../core/types.js';
import type { HttpTransport } from '../../http/transport.js';
import type { SecretProvider } from '../../security/secrets.js';

/**
 * TBO Holidays Hotel API (JSON), spec V2.1.
 * Flow: Search -> PreBook -> Book -> BookingDetail, Cancel.
 */
export interface TboAdapterConfig {
  id: string;
  /** e.g. https://api.tbotechnology.in/TBOHolidays_HotelAPI (test) */
  baseUrl: string;
  environment: 'test' | 'production';
  /** TBO signs off certification before live credentials are issued. */
  certified: boolean;
  transport: HttpTransport;
  /**
   * Env var NAMES of the Basic-auth username/password. Optional: when the
   * credential is injected by a network proxy, leave this out.
   */
  secretNames?: { username: string; password: string };
  secrets?: SecretProvider;
  /** Used when the guest has no email/phone (TBO requires both). */
  agencyEmail: string;
  agencyPhone: string;
}

const STATUS = {
  OK: 200,
  NO_AVAILABILITY: 201,
  RATE_UNAVAILABLE: 207,
  INSUFFICIENT_BALANCE: 300,
  BOOKINGCODE_EXPIRED: 315,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  AGENT_BLOCKED: 402,
  BOOKING_FAIL: 405,
  LIMIT_EXCEEDED: 429,
  CANCEL_FAIL: 479,
  UNEXPECTED_ERROR: 500,
} as const;

const TIMEOUTS = { search: 23_000, prebook: 23_000, book: 120_000, detail: 30_000, cancel: 60_000 };

const MEAL: Record<string, BoardCode> = {
  room_only: 'RO',
  breakfast: 'BB',
  breakfast_for_1: 'BB',
  breakfast_for_2: 'BB',
  breakfast_lunch: 'HB',
  half_board: 'HB',
  full_board: 'FB',
  all_inclusive_all_meal: 'AI',
};

/**
 * BookingDetail.BookingStatus -> our status. Explicit on purpose: a status
 * that is not listed here (new, failed, misspelt, empty) is PENDING, which
 * the service treats as "not settled yet" and ends with a person checking.
 * It must never fall through to CONFIRMED.
 */
const BOOKING_STATUS: Record<string, SupplierBookingResult['status']> = {
  confirmed: 'CONFIRMED',
  vouchered: 'CONFIRMED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  cancelledandrefundawaited: 'CANCELLED',
  failed: 'FAILED',
  rejected: 'FAILED',
  pending: 'PENDING',
};

interface TboStatus { Code?: number; Description?: string }
interface TboSupplement { Index?: number; Type?: string; Description?: string; Price?: number; Currency?: string }
interface TboCancelPolicy { Index?: string; FromDate?: string; ChargeType?: string; CancellationCharge?: number }
interface TboRoom {
  Name?: string[];
  BookingCode?: string;
  Inclusion?: string;
  TotalFare?: number;
  TotalTax?: number;
  RoomPromotion?: string[] | string;
  CancelPolicies?: TboCancelPolicy[];
  MealType?: string;
  IsRefundable?: boolean;
  Supplements?: TboSupplement[][] | TboSupplement[];
  RateConditions?: string[];
}
interface TboHotelResult { HotelCode?: string; Currency?: string; Rooms?: TboRoom[] }

export class TboAdapter implements SupplierAdapter {
  readonly id: string;
  readonly environment: Environment;
  readonly capabilities: SupplierCapabilities = {
    multiRoom: true,
    maxHotelsPerSearch: 100,
    nativeCheckRate: true,
    lookupByClientReference: true,
    cancel: true,
    reconcileAfterMs: 120_000,
  };

  constructor(private readonly cfg: TboAdapterConfig) {
    if (cfg.environment === 'production' && !cfg.certified) {
      throw new Error(`${cfg.id}: TBO certification not signed off; production is blocked`);
    }
    this.id = cfg.id;
    this.environment = cfg.environment;
  }

  async search(req: SupplierSearchRequest, ctx: CallContext): Promise<SupplierOffer[]> {
    if (!req.nationality) {
      // TBO: never hardcode nationality; prices depend on it.
      throw new SupplierError(this.id, 'VALIDATION', 'search: guest nationality is required for TBO');
    }
    const res = await this.post<{ Status?: TboStatus; HotelResult?: TboHotelResult[] }>('search', 'Search', {
      CheckIn: req.checkIn,
      CheckOut: req.checkOut,
      HotelCodes: req.supplierHotelCodes.join(','),
      GuestNationality: req.nationality,
      PaxRooms: req.rooms.map((r) => ({ Adults: r.adults, Children: r.childrenAges.length, ChildrenAges: r.childrenAges })),
      ResponseTime: 20,
      IsDetailedResponse: false,
      Filters: { Refundable: false, NoOfRooms: 0, MealType: 'All' },
    }, TIMEOUTS.search, ctx, true);
    const code = res.Status?.Code;
    if (code === STATUS.NO_AVAILABILITY) return [];
    if (code !== STATUS.OK) throw this.error(code, res.Status?.Description, 'search');
    const nights = nightsBetween(req.checkIn, req.checkOut);
    return (res.HotelResult ?? []).flatMap((h) =>
      (h.Rooms ?? []).map((r) => this.toOffer(h, r, req.rooms.length, req.checkIn, nights)).filter((o): o is SupplierOffer => !!o),
    );
  }

  async checkRate(offer: RateOffer, ctx: CallContext): Promise<SupplierQuote> {
    const bookingCode = offer.supplierData['bookingCode'];
    if (!bookingCode) throw new SupplierError(this.id, 'VALIDATION', 'checkRate: offer has no BookingCode');
    const res = await this.post<{ Status?: TboStatus; HotelResult?: TboHotelResult[] }>('checkRate', 'PreBook', {
      BookingCode: bookingCode,
      PaymentMode: 'Limit',
    }, TIMEOUTS.prebook, ctx, true);
    const code = res.Status?.Code;
    if (code === STATUS.NO_AVAILABILITY || code === STATUS.RATE_UNAVAILABLE || code === STATUS.BOOKINGCODE_EXPIRED) {
      return { available: false };
    }
    if (code !== STATUS.OK) throw this.error(code, res.Status?.Description, 'checkRate');
    const hotel = res.HotelResult?.[0];
    const room = hotel?.Rooms?.[0];
    if (!hotel || !room) return { available: false };
    // TBO: the PreBook policy and norms are final for the booking.
    const fresh = this.toOffer(hotel, room, offer.occupancy.length, offer.checkIn, nightsBetween(offer.checkIn, offer.checkOut));
    return fresh ? { available: true, offer: fresh } : { available: false };
  }

  async book(req: SupplierBookRequest, ctx: CallContext): Promise<SupplierBookingResult> {
    if (req.payment.type !== 'AGENCY_CREDIT') {
      throw new SupplierError(this.id, 'VALIDATION', 'book: only agency credit (PaymentMode Limit) is enabled for TBO');
    }
    const bookingCode = req.offer.supplierData['bookingCode'];
    const totalFare = req.offer.supplierData['totalFare'];
    if (!bookingCode || !totalFare) throw new SupplierError(this.id, 'VALIDATION', 'book: offer is missing BookingCode/TotalFare');

    const res = await this.post<{ Status?: TboStatus; ConfirmationNumber?: string; ClientReferenceId?: string }>('book', 'Book', {
      BookingCode: bookingCode,
      CustomerDetails: req.guests.map((room) => ({
        CustomerNames: room.map((g) => ({
          Title: g.title ?? 'Mr',
          FirstName: g.firstName,
          LastName: g.lastName,
          Type: g.type === 'CHILD' ? 'Child' : 'Adult',
        })),
      })),
      ClientReferenceId: req.clientReference,
      // Our reference doubles as BookingReferenceId so BookingDetail can find it after a timeout.
      BookingReferenceId: req.clientReference,
      TotalFare: Number(totalFare),
      EmailId: req.holder.email ?? this.cfg.agencyEmail,
      PhoneNumber: digits(req.holder.phone) || digits(this.cfg.agencyPhone),
      BookingType: 'Voucher',
      PaymentMode: 'Limit',
    }, TIMEOUTS.book, ctx, false);

    const code = res.Status?.Code;
    if (code === STATUS.OK && res.ConfirmationNumber) {
      return { status: 'CONFIRMED', supplierBookingRef: res.ConfirmationNumber, total: req.offer.total, message: res.Status?.Description };
    }
    if (code === STATUS.OK) {
      throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'book: success without ConfirmationNumber');
    }
    throw this.error(code, res.Status?.Description, 'book');
  }

  async getBooking(ref: BookingLookup, ctx: CallContext): Promise<SupplierBookingResult | null> {
    const body: Record<string, string> = ref.supplierBookingRef
      ? { ConfirmationNumber: ref.supplierBookingRef, PaymentMode: 'Limit' }
      : { BookingReferenceId: ref.clientReference, PaymentMode: 'Limit' };
    const res = await this.post<{ Status?: TboStatus; BookingDetail?: Record<string, unknown> }>('getBooking', 'BookingDetail', body, TIMEOUTS.detail, ctx, true);
    const code = res.Status?.Code;
    if (code === STATUS.UNAUTHORIZED || code === STATUS.AGENT_BLOCKED || code === STATUS.LIMIT_EXCEEDED || code === STATUS.UNEXPECTED_ERROR) {
      throw this.error(code, res.Status?.Description, 'getBooking');
    }
    const d = res.BookingDetail;
    if (code !== STATUS.OK || !d) return null; // not found (service never treats this as "failed")
    const statusRaw = String(d['BookingStatus'] ?? '').toLowerCase().replace(/[\s_-]/g, '');
    const status: SupplierBookingResult['status'] = BOOKING_STATUS[statusRaw] ?? 'PENDING';
    const rooms = (d['Rooms'] as { TotalFare?: number; Currency?: string }[] | undefined) ?? [];
    const currency = rooms[0]?.Currency;
    const total = currency ? sumAmounts(rooms.map((r) => r.TotalFare ?? 0), currency) : undefined;
    return {
      status,
      supplierBookingRef: str(d['ConfirmationNumber']),
      hotelConfirmationNumber: str(d['HotelConfirmationNumber']),
      total,
      message: str(d['BookingStatus']),
    };
  }

  async cancel(ref: BookingLookup, ctx: CallContext): Promise<SupplierCancelResult> {
    if (!ref.supplierBookingRef) throw new SupplierError(this.id, 'VALIDATION', 'cancel: TBO ConfirmationNumber missing');
    const res = await this.post<{ Status?: TboStatus; ConfirmationNumber?: string }>('cancel', 'Cancel', {
      ConfirmationNumber: ref.supplierBookingRef,
    }, TIMEOUTS.cancel, ctx, false);
    const code = res.Status?.Code;
    if (code === STATUS.OK) return { cancelled: true, cancellationRef: res.ConfirmationNumber ?? ref.supplierBookingRef, message: res.Status?.Description };
    if (code === STATUS.CANCEL_FAIL) return { cancelled: false, message: res.Status?.Description ?? 'Cancel failed' };
    throw this.error(code, res.Status?.Description, 'cancel');
  }

  // ------------------------------------------------------------------ mapping

  private toOffer(h: TboHotelResult, r: TboRoom, roomCount: number, checkIn: string, nights: number): SupplierOffer | undefined {
    if (!h.HotelCode || !h.Currency || !r.BookingCode || typeof r.TotalFare !== 'number') return undefined;
    const currency = h.Currency.toUpperCase();
    const total = amount(r.TotalFare, currency);
    const names = r.Name ?? [];
    const supplements = (r.Supplements ?? []).flat() as TboSupplement[];
    const payAtHotel = supplements
      .filter((s) => s.Type === 'AtProperty' && typeof s.Price === 'number' && s.Currency)
      .map((s) => amount(s.Price!, s.Currency!.toUpperCase()));
    const remarks = [
      ...(r.Inclusion ? [r.Inclusion] : []),
      ...(Array.isArray(r.RoomPromotion) ? r.RoomPromotion : r.RoomPromotion ? [r.RoomPromotion] : []),
      ...supplements.map((s) => `${s.Type === 'AtProperty' ? 'Pay at hotel' : 'Included'}: ${s.Description ?? ''} ${s.Price ?? ''} ${s.Currency ?? ''}`.trim()),
      ...(r.RateConditions ?? []),
    ];
    return {
      supplierHotelCode: h.HotelCode,
      ratePlanCode: r.BookingCode,
      ratePlanName: names[0],
      rooms: Array.from({ length: roomCount }, (_, i) => ({
        occupancyIndex: i,
        supplierRoomCode: names[i] ?? names[0] ?? 'ROOM',
        roomName: names[i] ?? names[0] ?? 'Room',
      })),
      board: r.MealType ? MEAL[r.MealType.toLowerCase()] : undefined,
      boardRaw: r.MealType,
      total,
      taxesIncluded: true,
      payAtHotel: payAtHotel.length ? payAtHotel : undefined,
      paymentModel: 'PREPAID',
      cancellation: cancelPolicy(r, total, nights, checkIn),
      remarks: remarks.length ? remarks : undefined,
      supplierData: { bookingCode: r.BookingCode, totalFare: String(r.TotalFare) },
    };
  }

  // ---------------------------------------------------------------- transport

  private async post<T>(operation: string, method: string, body: unknown, timeoutMs: number, ctx: CallContext, idempotent: boolean): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    const names = this.cfg.secretNames;
    if (names && this.cfg.secrets?.has(names.username) && this.cfg.secrets.has(names.password)) {
      const u = this.cfg.secrets.get(names.username);
      const p = this.cfg.secrets.get(names.password);
      headers['authorization'] = `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    }
    const res = await this.cfg.transport.send(
      { operation, method: 'POST', url: `${this.cfg.baseUrl.replace(/\/+$/, '')}/${method}`, headers, body: JSON.stringify(body), timeoutMs, idempotent },
      ctx,
    );
    try {
      return JSON.parse(res.body) as T;
    } catch (err) {
      throw new SupplierError(this.id, idempotent ? 'PROTOCOL' : 'OUTCOME_UNKNOWN', `${operation}: invalid JSON (HTTP ${res.status})`, { cause: err });
    }
  }

  private error(code: number | undefined, description: string | undefined, operation: string): SupplierError {
    const map: Record<number, SupplierErrorCode> = {
      [STATUS.NO_AVAILABILITY]: 'SOLD_OUT',
      [STATUS.RATE_UNAVAILABLE]: 'SOLD_OUT',
      [STATUS.BOOKINGCODE_EXPIRED]: 'RATE_CHANGED',
      [STATUS.INSUFFICIENT_BALANCE]: 'VALIDATION',
      [STATUS.INVALID_REQUEST]: 'VALIDATION',
      [STATUS.UNAUTHORIZED]: 'AUTH',
      [STATUS.AGENT_BLOCKED]: 'AUTH',
      [STATUS.BOOKING_FAIL]: 'VALIDATION',
      [STATUS.LIMIT_EXCEEDED]: 'RATE_LIMITED',
      [STATUS.CANCEL_FAIL]: 'VALIDATION',
    };
    let kind: SupplierErrorCode = (code !== undefined ? map[code] : undefined) ?? 'PROTOCOL';
    // On a write call an unexpected error may hide a booking that was made.
    if ((operation === 'book' || operation === 'cancel') && (code === undefined || code === STATUS.UNEXPECTED_ERROR || kind === 'PROTOCOL')) {
      kind = 'OUTCOME_UNKNOWN';
    }
    return new SupplierError(this.id, kind, `${operation}: TBO ${code ?? '?'} ${description ?? ''}`.trim(), { supplierCode: code?.toString() });
  }
}

// --------------------------------------------------------------------- helpers

/** TBO returns JSON numbers that can carry more decimals than the currency; round half-up to the minor unit. */
export function amount(value: number, currency: string): Money {
  const exp = currencyExponent(currency);
  const minor = Math.round((value + Number.EPSILON) * 10 ** exp);
  return { minor, currency };
}

function sumAmounts(values: number[], currency: string): Money {
  return { minor: values.reduce((s, v) => s + amount(v, currency).minor, 0), currency };
}

/** TBO FromDate: "dd-MM-yyyy HH:mm:ss" (hotel local time, taken as UTC). */
export function tboDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/.exec(s.trim());
  if (m) {
    const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function cancelPolicy(r: TboRoom, total: Money, nights: number, _checkIn: string): CancellationPolicy {
  const penalties: CancellationPenalty[] = [];
  const texts: string[] = [];
  for (const p of r.CancelPolicies ?? []) {
    const from = tboDate(p.FromDate);
    const charge = p.CancellationCharge ?? 0;
    const type = (p.ChargeType ?? '').toLowerCase();
    let amt: Money | undefined;
    if (type === 'fixed') amt = amount(charge, total.currency);
    else if (type === 'percentage') amt = { minor: Math.round((total.minor * charge) / 100), currency: total.currency };
    else if (type.startsWith('night') && nights > 0) amt = { minor: Math.round((total.minor / nights) * Math.min(charge, nights)), currency: total.currency };
    else texts.push(`${p.ChargeType ?? '?'} ${charge} from ${p.FromDate ?? '?'}`);
    if (from && amt && amt.minor > 0) penalties.push({ from, amount: amt });
  }
  penalties.sort((a, b) => a.from.localeCompare(b.from));
  const refundable = r.IsRefundable !== false;
  if (!refundable && penalties.length === 0) penalties.push({ from: new Date(0).toISOString(), amount: total });
  if (!r.CancelPolicies) texts.push('Final cancellation policy is confirmed at re-check (PreBook).');
  return { refundable, penalties, text: texts.join(' ') || undefined };
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function digits(s: string | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function str(v: unknown): string | undefined {
  return v === undefined || v === null || v === '' ? undefined : String(v);
}

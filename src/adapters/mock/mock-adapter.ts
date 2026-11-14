import { randomUUID } from 'node:crypto';
import { SupplierError } from '../../core/errors.js';
import { moneyFromDecimal } from '../../core/money.js';
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
import type { RateOffer } from '../../core/types.js';

export interface MockHotel {
  code: string;
  name: string;
  /** Price per room per night, decimal string. */
  nightly: string;
  currency: string;
}

/** Switches to rehearse the hard cases before a real supplier ever sees traffic. */
export interface MockScenario {
  /** checkRate returns this many % more than search. */
  priceIncreasePercent?: number;
  soldOutOnCheck?: boolean;
  /** book throws OUTCOME_UNKNOWN but the booking DOES exist at the "supplier". */
  timeoutButBooked?: boolean;
  /** book throws OUTCOME_UNKNOWN and the booking does NOT exist. */
  timeoutNotBooked?: boolean;
  rejectBooking?: boolean;
  searchDelayMs?: number;
  searchFails?: boolean;
}

/**
 * Fake supplier for development and tests. Lets the CRM be built and the
 * whole booking flow be tested before any supplier contract is signed.
 */
export class MockSupplierAdapter implements SupplierAdapter {
  readonly capabilities: SupplierCapabilities = {
    multiRoom: true,
    maxHotelsPerSearch: 50,
    nativeCheckRate: true,
    lookupByClientReference: true,
    cancel: true,
  };

  readonly bookings = new Map<string, { ref: string; status: 'CONFIRMED' | 'CANCELLED'; offer: RateOffer }>();
  readonly calls: string[] = [];
  scenario: MockScenario;

  constructor(readonly id: string, private readonly hotels: MockHotel[], scenario: MockScenario = {}) {
    this.scenario = scenario;
  }

  async search(req: SupplierSearchRequest, ctx: CallContext): Promise<SupplierOffer[]> {
    this.calls.push('search');
    if (this.scenario.searchDelayMs) await delay(this.scenario.searchDelayMs, ctx.signal);
    if (this.scenario.searchFails) throw new SupplierError(this.id, 'UNAVAILABLE', 'mock search down');
    const nights = (Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000;
    return this.hotels
      .filter((h) => req.supplierHotelCodes.includes(h.code))
      .flatMap((h) => [
        this.offer(h, req, nights, 'BAR-RO', 'RO', 1),
        this.offer(h, req, nights, 'BAR-AI', 'AI', 1.6),
      ]);
  }

  async checkRate(offer: RateOffer): Promise<SupplierQuote> {
    this.calls.push('checkRate');
    if (this.scenario.soldOutOnCheck) return { available: false };
    const pct = this.scenario.priceIncreasePercent ?? 0;
    const minor = Math.round(offer.total.minor * (1 + pct / 100));
    return {
      available: true,
      offer: { ...toSupplierOffer(offer), total: { minor, currency: offer.total.currency } },
    };
  }

  async book(req: SupplierBookRequest): Promise<SupplierBookingResult> {
    this.calls.push('book');
    if (this.scenario.rejectBooking) throw new SupplierError(this.id, 'SOLD_OUT', 'mock: no rooms');
    if (this.scenario.timeoutNotBooked) throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'mock timeout');
    const ref = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.bookings.set(req.clientReference, { ref, status: 'CONFIRMED', offer: req.offer });
    if (this.scenario.timeoutButBooked) throw new SupplierError(this.id, 'OUTCOME_UNKNOWN', 'mock timeout');
    return { status: 'CONFIRMED', supplierBookingRef: ref, hotelConfirmationNumber: `H-${ref}`, total: req.offer.total };
  }

  async getBooking(ref: BookingLookup): Promise<SupplierBookingResult | null> {
    this.calls.push('getBooking');
    const b = this.bookings.get(ref.clientReference);
    if (!b) return null;
    return { status: b.status, supplierBookingRef: b.ref, hotelConfirmationNumber: `H-${b.ref}`, total: b.offer.total };
  }

  async cancel(ref: BookingLookup): Promise<SupplierCancelResult> {
    this.calls.push('cancel');
    const b = this.bookings.get(ref.clientReference);
    if (!b) throw new SupplierError(this.id, 'NOT_FOUND', 'mock: booking not found');
    b.status = 'CANCELLED';
    return { cancelled: true, cancellationRef: `CXL-${b.ref}` };
  }

  private offer(h: MockHotel, req: SupplierSearchRequest, nights: number, plan: string, board: 'RO' | 'AI', factor: number): SupplierOffer {
    const perNight = moneyFromDecimal(h.nightly, h.currency);
    const minor = Math.round(perNight.minor * factor) * nights * req.rooms.length;
    return {
      supplierHotelCode: h.code,
      ratePlanCode: plan,
      ratePlanName: `${h.name} ${board}`,
      rooms: req.rooms.map((_, i) => ({ occupancyIndex: i, supplierRoomCode: 'DBL', roomName: 'Double room' })),
      board,
      boardRaw: board,
      total: { minor, currency: h.currency },
      taxesIncluded: true,
      paymentModel: 'PREPAID',
      cancellation: { refundable: true, penalties: [] },
      supplierData: { plan },
    };
  }
}

export function toSupplierOffer(o: RateOffer): SupplierOffer {
  return {
    supplierHotelCode: o.supplierHotelCode,
    ratePlanCode: o.ratePlanCode,
    ratePlanName: o.ratePlanName,
    rooms: o.rooms,
    board: o.board,
    boardRaw: o.boardRaw,
    total: o.total,
    taxesIncluded: o.taxesIncluded,
    payAtHotel: o.payAtHotel,
    paymentModel: o.paymentModel,
    cancellation: o.cancellation,
    remarks: o.remarks,
    supplierData: o.supplierData,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
}

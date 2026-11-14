import type { Money } from './money.js';
import type {
  BoardCode,
  BookingStatus,
  CancellationPolicy,
  Guest,
  Holder,
  IsoDate,
  Occupancy,
  PaymentInstruction,
  RateOffer,
  SupplierId,
} from './types.js';

/**
 * The contract every supplier connection implements. Adding Omnibees,
 * Dingus, SynXis, DerbySoft or a hotel's own API = one class implementing
 * this interface. Nothing else in Apolles changes.
 */
export interface SupplierAdapter {
  readonly id: SupplierId;
  readonly capabilities: SupplierCapabilities;

  /** Live availability + prices for the given supplier hotel codes. */
  search(req: SupplierSearchRequest, ctx: CallContext): Promise<SupplierOffer[]>;

  /** Re-check one offer right before booking (price, availability, policy). */
  checkRate(offer: RateOffer, ctx: CallContext): Promise<SupplierQuote>;

  /** Create the booking. Must send `clientReference` to the supplier when the API allows it. */
  book(req: SupplierBookRequest, ctx: CallContext): Promise<SupplierBookingResult>;

  /**
   * Look up a booking. Used after a timeout to find out whether `book`
   * actually went through. Returns null when the supplier says it does not exist.
   */
  getBooking(ref: BookingLookup, ctx: CallContext): Promise<SupplierBookingResult | null>;

  cancel(ref: BookingLookup, ctx: CallContext): Promise<SupplierCancelResult>;
}

export interface SupplierCapabilities {
  /** Several rooms with different occupancies in one booking. */
  multiRoom: boolean;
  /** Max hotel codes per search call; the service splits larger searches. */
  maxHotelsPerSearch: number;
  /** Supplier has a separate re-check call. If false, checkRate re-runs search. */
  nativeCheckRate: boolean;
  /** Supplier can find a booking by OUR reference (key for safe reconciliation). */
  lookupByClientReference: boolean;
  cancel: boolean;
  /**
   * Wait this long after an unknown booking outcome before asking the
   * supplier (TBO requires 120 s). Earlier lookups can return a false "not found".
   */
  reconcileAfterMs?: number;
}

export interface CallContext {
  /** Correlates all supplier calls of one Apolles operation in the audit log. */
  requestId: string;
  signal?: AbortSignal;
}

export interface SupplierSearchRequest {
  checkIn: IsoDate;
  checkOut: IsoDate;
  rooms: Occupancy[];
  supplierHotelCodes: string[];
  currency: string;
  nationality?: string;
}

/** What an adapter returns from search; the service adds offerId + hotelId. */
export interface SupplierOffer {
  supplierHotelCode: string;
  ratePlanCode: string;
  ratePlanName?: string;
  rooms: { occupancyIndex: number; supplierRoomCode: string; roomName: string }[];
  /** Supplier's raw board code; mapped by the service via the mapping store. */
  boardRaw?: string;
  /** Adapter may already know the board (e.g. OTA meal plan codes). */
  board?: BoardCode;
  total: Money;
  taxesIncluded: boolean;
  payAtHotel?: Money[];
  paymentModel: 'PREPAID' | 'PAY_AT_HOTEL';
  cancellation: CancellationPolicy;
  remarks?: string[];
  supplierData: Record<string, string>;
}

export interface SupplierQuote {
  available: boolean;
  /** Fresh offer data (price/policy may differ from search). */
  offer?: SupplierOffer;
  /** Until when the supplier holds this price, if it says so. */
  expiresAt?: string;
}

export interface SupplierBookRequest {
  clientReference: string;
  offer: RateOffer;
  holder: Holder;
  guests: Guest[][];
  payment: PaymentInstruction;
  specialRequests?: string;
}

export interface SupplierBookingResult {
  status: Extract<BookingStatus, 'CONFIRMED' | 'ON_REQUEST' | 'FAILED' | 'CANCELLED' | 'PENDING'>;
  supplierBookingRef?: string;
  hotelConfirmationNumber?: string;
  total?: Money;
  message?: string;
}

export interface BookingLookup {
  clientReference: string;
  supplierBookingRef?: string;
  hotelId?: string;
  supplierHotelCode?: string;
  holderLastName?: string;
}

export interface SupplierCancelResult {
  cancelled: boolean;
  cancellationRef?: string;
  fee?: Money;
  message?: string;
}

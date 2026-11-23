import type { Money } from './money.js';

/**
 * Canonical Apolles model. Every supplier adapter translates its own API into
 * these types, so the rest of Apolles (CRM, quotes, vouchers) never sees a
 * supplier-specific format.
 */

export type SupplierId = string;

/** Internal Apolles hotel id (stable, ours, independent of any supplier). */
export type HotelId = string;

/**
 * Which side of a supplier we talk to. A "test" booking is not a real
 * reservation; every offer, quote and booking answer carries this so nobody
 * mistakes one for the other.
 */
export type Environment = 'test' | 'production';

/** ISO date, YYYY-MM-DD. */
export type IsoDate = string;
/** ISO date-time with offset, e.g. 2026-12-01T00:00:00Z. */
export type IsoDateTime = string;

export interface Occupancy {
  adults: number;
  /** Age of each child at check-in. */
  childrenAges: number[];
}

export interface SearchRequest {
  checkIn: IsoDate;
  checkOut: IsoDate;
  /** One entry per room. */
  rooms: Occupancy[];
  hotelIds: HotelId[];
  /** Currency the caller wants; suppliers may still answer in their own. */
  currency: string;
  /** Guest nationality, ISO 3166-1 alpha-2. Many rates depend on it. */
  nationality?: string;
  /** Restrict to specific suppliers. Default: all enabled ones. */
  suppliers?: SupplierId[];
}

export type BoardCode = 'RO' | 'BB' | 'HB' | 'FB' | 'AI' | 'UAI' | 'OTHER';

export interface CancellationPenalty {
  /** From this moment on, cancelling costs `amount`. */
  from: IsoDateTime;
  amount: Money;
}

export interface CancellationPolicy {
  refundable: boolean;
  penalties: CancellationPenalty[];
  /** Supplier's own wording, kept for the voucher / agent. */
  text?: string;
}

export type PaymentModel = 'PREPAID' | 'PAY_AT_HOTEL';

export interface OfferRoom {
  /** Index into SearchRequest.rooms. */
  occupancyIndex: number;
  supplierRoomCode: string;
  roomName: string;
}

export interface RateOffer {
  /** Opaque id Apolles uses to refer to this offer (quote/book). */
  offerId: string;
  supplierId: SupplierId;
  /** Supplier's test or production system. A test offer cannot become a real booking. */
  environment: Environment;
  hotelId: HotelId;
  supplierHotelCode: string;
  ratePlanCode: string;
  ratePlanName?: string;
  rooms: OfferRoom[];
  board: BoardCode;
  /** Supplier's own board code, before mapping. */
  boardRaw?: string;
  /** Total price we pay the supplier for the whole stay, all rooms. */
  total: Money;
  /** True when `total` already includes taxes. */
  taxesIncluded: boolean;
  /** Fees the guest pays at the hotel (resort fee, city tax). */
  payAtHotel?: Money[];
  paymentModel: PaymentModel;
  cancellation: CancellationPolicy;
  remarks?: string[];
  /** Search echo, needed to book. */
  checkIn: IsoDate;
  checkOut: IsoDate;
  occupancy: Occupancy[];
  /** Anything the adapter needs later to quote/book (tokens, keys). */
  supplierData: Record<string, string>;
}

export interface SupplierSearchStatus {
  supplierId: SupplierId;
  ok: boolean;
  offers: number;
  durationMs: number;
  error?: string;
  skipped?: 'CIRCUIT_OPEN' | 'NO_MAPPED_HOTELS' | 'DISABLED' | 'MULTI_ROOM_UNSUPPORTED';
  /** How many of the requested hotels this supplier has no mapping for. */
  unmappedHotels?: number;
  /** A large search is sent in parts; this many parts failed (their hotels are missing from the offers). */
  failedParts?: number;
}

export interface SearchResult {
  offers: RateOffer[];
  suppliers: SupplierSearchStatus[];
  /** Requested hotel ids that no searched supplier has a mapping for: they were not searched at all. */
  unmappedHotelIds: HotelId[];
}

export interface Quote {
  quoteId: string;
  environment: Environment;
  offer: RateOffer;
  /** Price shown at search time. */
  searchedTotal: Money;
  priceChanged: boolean;
  /** Policy text or penalties changed vs. search. */
  cancellationChanged: boolean;
  expiresAt: IsoDateTime;
}

export interface Guest {
  firstName: string;
  lastName: string;
  type: 'ADULT' | 'CHILD';
  age?: number;
  /** Some suppliers (TBO) require it. */
  title?: 'Mr' | 'Mrs' | 'Ms';
}

export interface Holder {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}

/**
 * How we pay the supplier. Card numbers are NEVER part of this object:
 * a virtual card is referenced by a token held in the card vault, and the
 * adapter only reads the real number at send time (see security/card-vault).
 */
export type PaymentInstruction =
  | { type: 'AGENCY_CREDIT' }
  | { type: 'VIRTUAL_CARD'; cardToken: string }
  | { type: 'PAY_AT_HOTEL'; guaranteeCardToken?: string };

export interface BookRequest {
  /** Our own unique id for this booking; also the idempotency key. */
  clientReference: string;
  quoteId: string;
  /** The price the agent/customer approved. Booking is refused above it (+ tolerance). */
  approvedTotal: Money;
  holder: Holder;
  /** guests[i] = guests of room i. */
  guests: Guest[][];
  payment: PaymentInstruction;
  specialRequests?: string;
}

export type BookingStatus =
  /** Sent to supplier, no answer yet. */
  | 'PENDING'
  | 'CONFIRMED'
  /** Supplier accepted but hotel has to confirm (on request). */
  | 'ON_REQUEST'
  /** Supplier said no. Safe to try again with a new quote. */
  | 'FAILED'
  /** We don't know if the supplier booked it (timeout etc.). Never rebook blindly. */
  | 'UNKNOWN'
  /** Reconciliation could not settle it; a person must check with the supplier. */
  | 'NEEDS_REVIEW'
  | 'CANCELLED';

export interface BookingRecord {
  clientReference: string;
  supplierId: SupplierId;
  /** Test or production, fixed when the booking was made. */
  environment: Environment;
  hotelId: HotelId;
  status: BookingStatus;
  /** The quote this reference was booked with; a replay with another quote is refused. */
  quoteId?: string;
  /** The price the client approved, kept to check the supplier's final total against. */
  approvedTotal?: Money;
  offer: RateOffer;
  total: Money;
  holder: Holder;
  guests: Guest[][];
  paymentType: PaymentInstruction['type'];
  supplierBookingRef?: string;
  hotelConfirmationNumber?: string;
  failureReason?: string;
  /**
   * Set when a person should look at this booking even though it has a
   * status: final price above the approved one, another currency, a cancel
   * with an unknown outcome, a booking that could not be confirmed.
   */
  reviewReason?: string;
  /**
   * A cancel was sent and we do not know whether the supplier processed it.
   * Reconcile keeps asking the supplier; cancel may be sent again.
   */
  cancelOutcomeUnknown?: boolean;
  /** Supplier lookups that got a real answer without settling the booking. */
  reconcileAttempts: number;
  /** Last time the supplier was asked about this booking. */
  lastCheckedAt?: IsoDateTime;
  cancellationRef?: string;
  cancellationFee?: Money;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  history: { at: IsoDateTime; status: BookingStatus; note?: string }[];
}

/**
 * What the API returns for a booking: the record plus `booked`, which is
 * true only when the supplier confirmed the booking. FAILED, UNKNOWN,
 * NEEDS_REVIEW, ON_REQUEST, PENDING and CANCELLED are all `booked: false`.
 */
export type BookingAnswer = BookingRecord & { booked: boolean };

/** A person settles a NEEDS_REVIEW booking after checking with the supplier. */
export interface ResolveRequest {
  status: 'CONFIRMED' | 'CANCELLED' | 'FAILED';
  /** What was checked and with whom; written to the booking history. */
  note: string;
  /** The supplier's booking number, when the person found it out. */
  supplierBookingRef?: string;
}

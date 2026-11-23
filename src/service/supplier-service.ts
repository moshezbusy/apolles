import { randomUUID } from 'node:crypto';
import { RequestError, SupplierError, type SupplierErrorCode } from '../core/errors.js';
import { compareMoney, percentChange, type Money } from '../core/money.js';
import type { SupplierOffer } from '../core/supplier.js';
import type {
  BookRequest,
  BookingAnswer,
  BookingRecord,
  BookingStatus,
  Quote,
  RateOffer,
  SearchRequest,
  SearchResult,
  SupplierSearchStatus,
} from '../core/types.js';
import { normalizeClientReference, parseBookRequest, parseSearchRequest } from '../core/validate.js';
import { sleep } from '../http/transport.js';
import type { MappingStore } from '../mapping/mapping.js';
import type { BookingStore } from '../store/booking-store.js';
import type { OfferCache } from '../store/offer-cache.js';
import type { RegisteredSupplier, SupplierRegistry } from './registry.js';

export interface ServiceOptions {
  /** Max allowed price increase between approval and booking, in percent. 0 = none. */
  maxPriceIncreasePercent: number;
  offerTtlMs: number;
  quoteTtlMs: number;
  /** Waits (ms) before each immediate reconciliation try after an unknown booking outcome. */
  reconcileDelaysMs: number[];
  /** After this many failed lookups a booking goes to NEEDS_REVIEW (a person checks). */
  maxReconcileAttempts: number;
  now: () => Date;
}

const DEFAULTS: ServiceOptions = {
  maxPriceIncreasePercent: 0,
  offerTtlMs: 20 * 60_000,
  quoteTtlMs: 10 * 60_000,
  reconcileDelaysMs: [2_000, 5_000, 10_000],
  maxReconcileAttempts: 10,
  now: () => new Date(),
};

/** Supplier errors on book that mean "definitely not booked". Everything else = maybe booked. */
const DEFINITE_BOOK_FAILURES: ReadonlySet<SupplierErrorCode> = new Set(['AUTH', 'VALIDATION', 'SOLD_OUT', 'RATE_CHANGED']);

/**
 * The single entry point the rest of Apolles talks to. It fans searches out
 * to every supplier, guards prices, makes booking idempotent, and resolves
 * "did it book or not?" situations without ever double-booking.
 */
export class SupplierService {
  private readonly opts: ServiceOptions;

  constructor(
    private readonly registry: SupplierRegistry,
    private readonly mapping: MappingStore,
    private readonly bookings: BookingStore,
    private readonly cache: OfferCache,
    opts: Partial<ServiceOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  // ---------------------------------------------------------------- search

  async search(input: SearchRequest, requestId: string = randomUUID()): Promise<SearchResult> {
    const req = parseSearchRequest(input, this.opts.now());
    const wanted = this.registry.all().filter((s) => !req.suppliers || req.suppliers.includes(s.adapter.id));
    const results = await Promise.all(wanted.map((s) => this.searchOne(s, req, requestId)));
    const offers = results.flatMap((r) => r.offers);
    offers.sort((a, b) => (a.total.currency === b.total.currency ? a.total.minor - b.total.minor : a.total.currency.localeCompare(b.total.currency)));
    await Promise.all(offers.map((o) => this.cache.putOffer(o, this.opts.offerTtlMs)));
    return { offers, suppliers: results.map((r) => r.status) };
  }

  private async searchOne(
    s: RegisteredSupplier,
    req: SearchRequest,
    requestId: string,
  ): Promise<{ offers: RateOffer[]; status: SupplierSearchStatus }> {
    const id = s.adapter.id;
    const started = Date.now();
    const status = (extra: Partial<SupplierSearchStatus>): SupplierSearchStatus => ({
      supplierId: id, ok: true, offers: 0, durationMs: Date.now() - started, ...extra,
    });
    if (!s.settings.enabled) return { offers: [], status: status({ skipped: 'DISABLED' }) };
    if (s.breaker.isOpen) return { offers: [], status: status({ ok: false, skipped: 'CIRCUIT_OPEN' }) };

    if (req.rooms.length > 1 && !s.adapter.capabilities.multiRoom) {
      return { offers: [], status: status({ skipped: 'MULTI_ROOM_UNSUPPORTED' }) };
    }
    const codes = await this.mapping.supplierHotelCodes(id, req.hotelIds);
    if (codes.size === 0) return { offers: [], status: status({ skipped: 'NO_MAPPED_HOTELS' }) };

    const signal = AbortSignal.timeout(s.settings.searchTimeoutMs);
    const chunks = chunk([...codes.values()], s.adapter.capabilities.maxHotelsPerSearch);
    try {
      const raw = (
        await Promise.all(
          chunks.map((supplierHotelCodes) =>
            s.adapter.search(
              {
                checkIn: req.checkIn,
                checkOut: req.checkOut,
                rooms: req.rooms,
                supplierHotelCodes,
                currency: req.currency,
                nationality: req.nationality,
              },
              { requestId, signal },
            ),
          ),
        )
      ).flat();
      const offers: RateOffer[] = [];
      for (const o of raw) {
        const mapped = await this.toRateOffer(id, o, req);
        if (mapped) offers.push(mapped);
      }
      s.breaker.success();
      return { offers, status: status({ offers: offers.length }) };
    } catch (err) {
      s.breaker.failure();
      const msg = signal.aborted ? `timed out after ${s.settings.searchTimeoutMs}ms` : errorMessage(err);
      return { offers: [], status: status({ ok: false, error: msg }) };
    }
  }

  private async toRateOffer(supplierId: string, o: SupplierOffer, req: { checkIn: string; checkOut: string; rooms: RateOffer['occupancy'] }): Promise<RateOffer | undefined> {
    const hotelId = await this.mapping.hotelIdFor(supplierId, o.supplierHotelCode);
    if (!hotelId) return undefined; // supplier returned a hotel we never asked for / don't know
    return {
      offerId: `${supplierId}~${randomUUID()}`,
      supplierId,
      environment: this.registry.require(supplierId).adapter.environment,
      hotelId,
      supplierHotelCode: o.supplierHotelCode,
      ratePlanCode: o.ratePlanCode,
      ratePlanName: o.ratePlanName,
      rooms: o.rooms,
      board: o.board ?? (await this.mapping.board(supplierId, o.boardRaw)),
      boardRaw: o.boardRaw,
      total: o.total,
      taxesIncluded: o.taxesIncluded,
      payAtHotel: o.payAtHotel,
      paymentModel: o.paymentModel,
      cancellation: o.cancellation,
      remarks: o.remarks,
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      occupancy: req.rooms,
      supplierData: o.supplierData,
    };
  }

  // ----------------------------------------------------------------- quote

  /** Re-check an offer with the supplier right before showing the final price / booking. */
  async quote(offerId: string, requestId: string = randomUUID()): Promise<Quote> {
    const offer = await this.cache.getOffer(offerId);
    if (!offer) throw new RequestError('OFFER_EXPIRED', 'Offer expired, search again', 410);
    const s = this.registry.require(offer.supplierId);
    const q = await s.adapter.checkRate(offer, { requestId });
    if (!q.available || !q.offer) throw new RequestError('SOLD_OUT', 'This rate is no longer available', 409);

    const fresh = await this.toRateOffer(offer.supplierId, q.offer, { checkIn: offer.checkIn, checkOut: offer.checkOut, rooms: offer.occupancy });
    if (!fresh) throw new RequestError('SOLD_OUT', 'Supplier returned a different hotel', 409);
    fresh.offerId = offer.offerId;

    const now = this.opts.now().getTime();
    const supplierExpiry = q.expiresAt ? Date.parse(q.expiresAt) : Infinity;
    const expiresAt = new Date(Math.min(now + this.opts.quoteTtlMs, supplierExpiry)).toISOString();
    const quote: Quote = {
      quoteId: randomUUID(),
      environment: fresh.environment,
      offer: fresh,
      searchedTotal: offer.total,
      priceChanged: !sameMoney(offer.total, fresh.total),
      cancellationChanged: JSON.stringify(offer.cancellation) !== JSON.stringify(fresh.cancellation),
      expiresAt,
    };
    await this.cache.putQuote(quote, Math.max(0, Date.parse(expiresAt) - now));
    return quote;
  }

  // ------------------------------------------------------------------ book

  async book(input: BookRequest, requestId: string = randomUUID()): Promise<BookingAnswer> {
    // Checks every field and upper-cases the reference, before any record exists.
    const req = parseBookRequest(input);

    // Idempotency: same clientReference never books twice.
    const existing = await this.bookings.get(req.clientReference);
    if (existing) return this.replay(existing, req);

    const quote = await this.cache.getQuote(req.quoteId);
    if (!quote || Date.parse(quote.expiresAt) <= this.opts.now().getTime()) {
      throw new RequestError('QUOTE_EXPIRED', 'Quote expired, re-check the rate', 410);
    }
    const offer = quote.offer;
    this.checkPrice(offer.total, req.approvedTotal);
    this.checkGuests(offer, req);
    if (offer.paymentModel === 'PREPAID' && req.payment.type === 'PAY_AT_HOTEL') {
      throw new RequestError('PAYMENT_MISMATCH', 'This rate must be prepaid', 400);
    }

    const s = this.registry.require(offer.supplierId);
    // A quote is good for one booking. Without this, the same quote under a
    // second reference would book the same room twice.
    if (!(await this.cache.claimQuote(req.quoteId, req.clientReference))) {
      throw new RequestError('QUOTE_ALREADY_USED', 'This quote was already used for another booking; get a new quote', 409);
    }
    const now = this.iso();
    const record: BookingRecord = {
      clientReference: req.clientReference,
      supplierId: offer.supplierId,
      environment: s.adapter.environment,
      hotelId: offer.hotelId,
      status: 'PENDING',
      quoteId: req.quoteId,
      approvedTotal: req.approvedTotal,
      offer,
      total: offer.total,
      holder: req.holder,
      guests: req.guests,
      paymentType: req.payment.type,
      reconcileAttempts: 0,
      createdAt: now,
      updatedAt: now,
      history: [{ at: now, status: 'PENDING', note: 'sent to supplier' }],
    };
    if (!(await this.bookings.create(record))) {
      // Lost a race with a parallel request using the same reference.
      return this.replay((await this.bookings.get(req.clientReference))!, req);
    }

    // Set by the transport right before the request leaves. Still false in
    // the catch below = the error happened on our side and nothing was sent.
    let sent = false;
    try {
      const res = await s.adapter.book(
        {
          clientReference: req.clientReference,
          offer,
          holder: req.holder,
          guests: req.guests,
          payment: req.payment,
          specialRequests: req.specialRequests,
        },
        { requestId, onSend: () => { sent = true; } },
      );
      record.supplierBookingRef = res.supplierBookingRef;
      record.hotelConfirmationNumber = res.hotelConfirmationNumber;
      if (res.total) record.total = res.total;
      const status: BookingStatus = res.status === 'PENDING' ? 'UNKNOWN' : res.status === 'CANCELLED' ? 'FAILED' : res.status;
      if (status === 'FAILED') record.failureReason = res.message ?? 'Supplier rejected the booking';
      this.transition(record, status, res.message);
      await this.bookings.update(record);
    } catch (err) {
      if (err instanceof SupplierError && DEFINITE_BOOK_FAILURES.has(err.code)) {
        record.failureReason = `${err.code}: ${err.message}`;
        this.transition(record, 'FAILED', record.failureReason);
        await this.bookings.update(record);
        return this.answer(record);
      }
      if (!sent && !(err instanceof SupplierError && err.outcomeUnknown)) {
        // Missing secret, no card vault, a bug in building the request:
        // the supplier never saw this booking, so it definitely does not exist.
        record.failureReason = `Not sent to the supplier: ${errorMessage(err)}`;
        this.transition(record, 'FAILED', record.failureReason);
        await this.bookings.update(record);
        return this.answer(record);
      }
      // We do not know whether the supplier created the booking.
      this.transition(record, 'UNKNOWN', errorMessage(err));
      await this.bookings.update(record);
    }

    if (record.status === 'UNKNOWN') return this.answer(await this.reconcileNow(record, requestId));
    return this.answer(record);
  }

  /** The same reference again: the same booking, unless it asks for something else. */
  private replay(existing: BookingRecord, req: BookRequest): BookingAnswer {
    if (existing.quoteId !== undefined && existing.quoteId !== req.quoteId) {
      throw new RequestError(
        'REFERENCE_REUSED',
        'This clientReference already belongs to a booking made with a different quote. Use a new reference for a new booking.',
        409,
      );
    }
    return this.answer(existing);
  }

  private async reconcileNow(record: BookingRecord, requestId: string): Promise<BookingRecord> {
    let current = record;
    for (const delay of this.opts.reconcileDelaysMs) {
      if (delay > 0) await sleep(delay);
      current = await this.reconcileOne(current, requestId);
      if (current.status !== 'UNKNOWN') break;
    }
    return current;
  }

  /** Ask the supplier what happened to an UNKNOWN booking. Never re-sends the booking. */
  async reconcileOne(record: BookingRecord, requestId: string = randomUUID()): Promise<BookingRecord> {
    if (record.status !== 'UNKNOWN') return record;
    const s = this.registry.require(record.supplierId);
    const waitMs = s.adapter.capabilities.reconcileAfterMs ?? 0;
    if (waitMs > 0) {
      const since = [...record.history].reverse().find((h) => h.status === 'UNKNOWN')?.at ?? record.updatedAt;
      if (this.opts.now().getTime() - Date.parse(since) < waitMs) return record; // too early; the scheduler retries
    }
    if (!s.adapter.capabilities.lookupByClientReference && !record.supplierBookingRef) {
      this.transition(record, 'NEEDS_REVIEW', 'Supplier cannot look up by our reference; check manually');
      await this.bookings.update(record);
      return record;
    }
    record.reconcileAttempts += 1;
    try {
      const found = await s.adapter.getBooking(
        {
          clientReference: record.clientReference,
          supplierBookingRef: record.supplierBookingRef,
          hotelId: record.hotelId,
          supplierHotelCode: record.offer.supplierHotelCode,
          holderLastName: record.holder.lastName,
        },
        { requestId },
      );
      if (found && found.status !== 'PENDING') {
        record.supplierBookingRef = found.supplierBookingRef ?? record.supplierBookingRef;
        record.hotelConfirmationNumber = found.hotelConfirmationNumber ?? record.hotelConfirmationNumber;
        if (found.total) record.total = found.total;
        this.transition(record, found.status === 'CANCELLED' ? 'CANCELLED' : found.status, 'reconciled with supplier');
        await this.bookings.update(record);
        return record;
      }
    } catch (err) {
      record.history.push({ at: this.iso(), status: record.status, note: `lookup failed: ${errorMessage(err)}` });
    }
    if (record.reconcileAttempts >= this.opts.maxReconcileAttempts) {
      this.transition(record, 'NEEDS_REVIEW', 'Could not confirm with supplier; check manually before rebooking');
    }
    record.updatedAt = this.iso();
    await this.bookings.update(record);
    return record;
  }

  /** Run from a scheduler (e.g. every minute) to settle all UNKNOWN bookings. */
  async reconcilePending(): Promise<BookingAnswer[]> {
    const pending = await this.bookings.listByStatus(['UNKNOWN']);
    const out: BookingAnswer[] = [];
    for (const r of pending) out.push(this.answer(await this.reconcileOne(r)));
    return out;
  }

  // ------------------------------------------------------- get / cancel

  async getBooking(clientReference: string): Promise<BookingAnswer> {
    return this.answer(await this.load(clientReference));
  }

  private async load(clientReference: string): Promise<BookingRecord> {
    const r = await this.bookings.get(normalizeClientReference(clientReference));
    if (!r) throw new RequestError('NOT_FOUND', 'Booking not found', 404);
    return r;
  }

  async cancel(clientReference: string, requestId: string = randomUUID()): Promise<BookingAnswer> {
    const record = await this.load(clientReference);
    if (record.status === 'CANCELLED') return this.answer(record);
    if (record.status !== 'CONFIRMED' && record.status !== 'ON_REQUEST') {
      throw new RequestError('NOT_CANCELLABLE', `Booking is ${record.status}`, 409);
    }
    const s = this.registry.require(record.supplierId);
    if (!s.adapter.capabilities.cancel) {
      throw new RequestError('NOT_SUPPORTED', 'Supplier does not support cancel by API; cancel manually', 409);
    }
    try {
      const res = await s.adapter.cancel(
        {
          clientReference: record.clientReference,
          supplierBookingRef: record.supplierBookingRef,
          hotelId: record.hotelId,
          supplierHotelCode: record.offer.supplierHotelCode,
          holderLastName: record.holder.lastName,
        },
        { requestId },
      );
      if (!res.cancelled) throw new RequestError('CANCEL_REFUSED', res.message ?? 'Supplier refused the cancellation', 409);
      record.cancellationRef = res.cancellationRef;
      record.cancellationFee = res.fee;
      this.transition(record, 'CANCELLED', res.message);
    } catch (err) {
      if (err instanceof RequestError) throw err;
      if (err instanceof SupplierError && !err.outcomeUnknown) throw err;
      this.transition(record, 'NEEDS_REVIEW', `cancel outcome unknown: ${errorMessage(err)}`);
    }
    await this.bookings.update(record);
    return this.answer(record);
  }

  // ------------------------------------------------------------- helpers

  /** `booked` is true only when the supplier confirmed: the one field a caller needs to check. */
  private answer(record: BookingRecord): BookingAnswer {
    return { ...record, booked: record.status === 'CONFIRMED' };
  }

  private checkPrice(current: Money, approved: Money): void {
    if (current.currency !== approved.currency) {
      throw new RequestError('PRICE_CHANGED', `Currency changed to ${current.currency}`, 409);
    }
    if (compareMoney(current, approved) > 0 && percentChange(approved, current) > this.opts.maxPriceIncreasePercent) {
      throw new RequestError('PRICE_CHANGED', 'Price went up since it was approved; re-confirm with the client', 409);
    }
  }

  private checkGuests(offer: RateOffer, req: BookRequest): void {
    if (req.guests.length !== offer.occupancy.length) throw new RequestError('INVALID_REQUEST', 'Guests per room do not match the searched rooms');
    req.guests.forEach((room, i) => {
      const occ = offer.occupancy[i]!;
      const adults = room.filter((g) => g.type === 'ADULT').length;
      const children = room.filter((g) => g.type === 'CHILD').length;
      if (adults !== occ.adults || children !== occ.childrenAges.length) {
        throw new RequestError('INVALID_REQUEST', `Room ${i + 1}: guests do not match the searched occupancy`);
      }
    });
  }

  private transition(record: BookingRecord, status: BookingStatus, note?: string): void {
    const at = this.iso();
    record.status = status;
    record.updatedAt = at;
    record.history.push({ at, status, note });
  }

  private iso(): string {
    return this.opts.now().toISOString();
  }
}

function sameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

function chunk<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { randomUUID } from 'node:crypto';
import { NullAlertSink, type AlertEvent, type AlertSink } from '../alerts/alerts.js';
import { RequestError, SupplierError, type SupplierErrorCode } from '../core/errors.js';
import { exceedsTolerance, moneyToDecimal, type Money } from '../core/money.js';
import type { BookingLookup, SupplierBookingResult, SupplierOffer } from '../core/supplier.js';
import type {
  BookRequest,
  BookingAnswer,
  BookingRecord,
  BookingStatus,
  CancellationPolicy,
  Quote,
  RateOffer,
  ResolveRequest,
  SearchRequest,
  SearchResult,
  SupplierSearchStatus,
} from '../core/types.js';
import { normalizeClientReference, parseBookRequest, parseResolveRequest, parseSearchRequest } from '../core/validate.js';
import { sleep } from '../http/transport.js';
import type { MappingStore } from '../mapping/mapping.js';
import type { BookingStore } from '../store/booking-store.js';
import type { OfferCache } from '../store/offer-cache.js';
import { KeyedLock } from './keyed-lock.js';
import type { RegisteredSupplier, SupplierRegistry } from './registry.js';

export interface ServiceOptions {
  /** Max allowed price increase between approval and booking, in percent. 0 = none. */
  maxPriceIncreasePercent: number;
  offerTtlMs: number;
  quoteTtlMs: number;
  /** Waits (ms) before each immediate reconciliation try after an unknown booking outcome. */
  reconcileDelaysMs: number[];
  /** After this many lookups the supplier answered without settling it, a booking goes to NEEDS_REVIEW (a person checks). */
  maxReconcileAttempts: number;
  /** ON_REQUEST bookings are asked about at most this often (hotels take hours to answer). */
  onRequestPollIntervalMs: number;
  /** After this many checks an ON_REQUEST booking goes to NEEDS_REVIEW. 200 x 15 min is about two days. */
  maxOnRequestChecks: number;
  now: () => Date;
  /** Where "a person must look at this" goes. */
  alerts: AlertSink;
  log: (msg: string) => void;
}

const DEFAULTS: ServiceOptions = {
  maxPriceIncreasePercent: 0,
  offerTtlMs: 20 * 60_000,
  quoteTtlMs: 10 * 60_000,
  reconcileDelaysMs: [2_000, 5_000, 10_000],
  maxReconcileAttempts: 10,
  onRequestPollIntervalMs: 15 * 60_000,
  maxOnRequestChecks: 200,
  now: () => new Date(),
  alerts: new NullAlertSink(),
  log: (msg) => console.warn(msg),
};

/** Supplier errors on book that mean "definitely not booked". Everything else = maybe booked. */
const DEFINITE_BOOK_FAILURES: ReadonlySet<SupplierErrorCode> = new Set(['AUTH', 'VALIDATION', 'SOLD_OUT', 'RATE_CHANGED']);

/**
 * Lookup errors that say nothing about the booking: our credentials, our
 * rate limit, the network. They must not use up the attempts after which a
 * booking is handed to a person.
 */
const OUR_SIDE_LOOKUP_ERRORS: ReadonlySet<SupplierErrorCode> = new Set(['AUTH', 'RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT']);

/** What reconcile is trying to find out for a record. */
type Pending = 'BOOKING' | 'ON_REQUEST' | 'CANCEL';

/**
 * The single entry point the rest of Apolles talks to. It fans searches out
 * to every supplier, guards prices, makes booking idempotent, and resolves
 * "did it book or not?" situations without ever double-booking.
 */
export class SupplierService {
  private readonly opts: ServiceOptions;
  /** One booking reference = one operation at a time (book, reconcile, cancel, resolve). */
  private readonly locks = new KeyedLock();
  private reconcileRun: Promise<BookingAnswer[]> | undefined;

  constructor(
    private readonly registry: SupplierRegistry,
    private readonly mapping: MappingStore,
    private readonly bookings: BookingStore,
    private readonly cache: OfferCache,
    opts: Partial<ServiceOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    // A NaN here would make every price comparison false and switch the guard off without a word.
    const numbers = ['maxPriceIncreasePercent', 'offerTtlMs', 'quoteTtlMs', 'maxReconcileAttempts', 'onRequestPollIntervalMs', 'maxOnRequestChecks'] as const;
    for (const key of numbers) {
      const v = this.opts[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Service option ${key} must be a number, got ${JSON.stringify(v)}`);
    }
    if (this.opts.maxPriceIncreasePercent < 0) throw new Error('Service option maxPriceIncreasePercent cannot be negative');
  }

  // ---------------------------------------------------------------- search

  async search(input: SearchRequest, requestId: string = randomUUID()): Promise<SearchResult> {
    const req = parseSearchRequest(input, this.opts.now());
    const wanted = this.registry.all().filter((s) => !req.suppliers || req.suppliers.includes(s.adapter.id));
    const results = await Promise.all(wanted.map((s) => this.searchOne(s, req, requestId)));
    const offers = results.flatMap((r) => r.offers);
    offers.sort((a, b) => (a.total.currency === b.total.currency ? a.total.minor - b.total.minor : a.total.currency.localeCompare(b.total.currency)));
    await Promise.all(offers.map((o) => this.cache.putOffer(o, this.opts.offerTtlMs)));
    const mapped = new Set(results.flatMap((r) => r.mappedHotelIds));
    return {
      offers,
      suppliers: results.map((r) => r.status),
      unmappedHotelIds: req.hotelIds.filter((h) => !mapped.has(h)),
    };
  }

  private async searchOne(
    s: RegisteredSupplier,
    req: SearchRequest,
    requestId: string,
  ): Promise<{ offers: RateOffer[]; status: SupplierSearchStatus; mappedHotelIds: string[] }> {
    const id = s.adapter.id;
    const started = Date.now();
    const status = (extra: Partial<SupplierSearchStatus>): SupplierSearchStatus => ({
      supplierId: id, ok: true, offers: 0, durationMs: Date.now() - started, ...extra,
    });
    if (!s.settings.enabled) return { offers: [], status: status({ skipped: 'DISABLED' }), mappedHotelIds: [] };

    const codes = await this.mapping.supplierHotelCodes(id, req.hotelIds);
    const mappedHotelIds = [...codes.keys()];
    const unmapped = req.hotelIds.length - codes.size;
    const base: Partial<SupplierSearchStatus> = unmapped > 0 ? { unmappedHotels: unmapped } : {};
    const none = (extra: Partial<SupplierSearchStatus>) => ({ offers: [], status: status({ ...base, ...extra }), mappedHotelIds });

    if (s.breaker.isOpen) return none({ ok: false, skipped: 'CIRCUIT_OPEN' });
    if (req.rooms.length > 1 && !s.adapter.capabilities.multiRoom) return none({ skipped: 'MULTI_ROOM_UNSUPPORTED' });
    if (codes.size === 0) return none({ skipped: 'NO_MAPPED_HOTELS' });

    const signal = AbortSignal.timeout(s.settings.searchTimeoutMs);
    // A big search goes out in parts. One failed part must not throw away the others.
    const parts = await Promise.allSettled(
      chunk([...codes.values()], s.adapter.capabilities.maxHotelsPerSearch).map((supplierHotelCodes) =>
        s.adapter.search(
          { checkIn: req.checkIn, checkOut: req.checkOut, rooms: req.rooms, supplierHotelCodes, currency: req.currency, nationality: req.nationality },
          { requestId, signal },
        ),
      ),
    );
    const failed = parts.filter((p): p is PromiseRejectedResult => p.status === 'rejected');
    const firstError = failed[0]?.reason as unknown;
    const errorText = signal.aborted ? `timed out after ${s.settings.searchTimeoutMs}ms` : errorMessage(firstError);

    if (failed.length === parts.length) {
      // The breaker is for a supplier that is down. A request the supplier
      // refuses as invalid is our mistake, not an outage.
      if (!isCallerSideError(firstError)) s.breaker.failure();
      return none({ ok: false, error: errorText });
    }
    s.breaker.success();
    const offers: RateOffer[] = [];
    for (const p of parts) {
      if (p.status !== 'fulfilled') continue;
      for (const o of p.value) {
        const mapped = await this.toRateOffer(id, o, req);
        if (mapped) offers.push(mapped);
      }
    }
    const partial: Partial<SupplierSearchStatus> = failed.length
      ? { failedParts: failed.length, error: `${failed.length} of ${parts.length} parts of the search failed: ${errorText}` }
      : {};
    return { offers, status: status({ ...base, ...partial, offers: offers.length }), mappedHotelIds };
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
      cancellation: this.cancellationAsOfNow(o.cancellation),
      remarks: o.remarks,
      checkIn: req.checkIn,
      checkOut: req.checkOut,
      occupancy: req.rooms,
      supplierData: o.supplierData,
    };
  }

  /** "Refundable" with a penalty that already started is not refundable any more. */
  private cancellationAsOfNow(c: CancellationPolicy): CancellationPolicy {
    if (!c.refundable || c.penalties.length === 0) return c;
    const first = Math.min(...c.penalties.map((p) => Date.parse(p.from)));
    // An unreadable date counts as "already started": never promise a refund we cannot back up.
    if (Number.isNaN(first) || first <= this.opts.now().getTime()) return { ...c, refundable: false };
    return c;
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
    const expiresAt = new Date(Math.min(now + this.opts.quoteTtlMs, Number.isNaN(supplierExpiry) ? Infinity : supplierExpiry)).toISOString();
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
    return this.locks.run(req.clientReference, async () => this.answer(await this.bookLocked(req, requestId)));
  }

  private async bookLocked(req: BookRequest, requestId: string): Promise<BookingRecord> {
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
    // Stored (on disk, with the file store) BEFORE the supplier is called.
    if (!(await this.bookings.create(record))) {
      // Lost a race with another writer using the same reference.
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
      const status: BookingStatus = res.status === 'PENDING' ? 'UNKNOWN' : res.status === 'CANCELLED' ? 'FAILED' : res.status;
      if (status === 'FAILED') record.failureReason = res.message ?? 'Supplier rejected the booking';
      this.transition(record, status, res.message);
      this.applySupplierAnswer(record, res);
    } catch (err) {
      if (err instanceof SupplierError && DEFINITE_BOOK_FAILURES.has(err.code)) {
        record.failureReason = `${err.code}: ${err.message}`;
        this.transition(record, 'FAILED', record.failureReason);
      } else if (!sent && !(err instanceof SupplierError && err.outcomeUnknown)) {
        // Missing secret, no card vault, a bug in building the request:
        // the supplier never saw this booking, so it definitely does not exist.
        record.failureReason = `Not sent to the supplier: ${errorMessage(err)}`;
        this.transition(record, 'FAILED', record.failureReason);
      } else {
        // We do not know whether the supplier created the booking.
        this.transition(record, 'UNKNOWN', errorMessage(err));
      }
    }
    const saved = await this.commit(record);
    return saved.status === 'UNKNOWN' ? this.reconcileNow(saved, requestId) : saved;
  }

  /** The same reference again: the same booking, unless it asks for something else. */
  private replay(existing: BookingRecord, req: BookRequest): BookingRecord {
    if (existing.quoteId !== undefined && existing.quoteId !== req.quoteId) {
      throw new RequestError(
        'REFERENCE_REUSED',
        'This clientReference already belongs to a booking made with a different quote. Use a new reference for a new booking.',
        409,
      );
    }
    return existing;
  }

  // ------------------------------------------------------------- reconcile

  /** Right after an unknown outcome: ask the supplier a few times before answering the caller. Lock is held. */
  private async reconcileNow(record: BookingRecord, requestId: string): Promise<BookingRecord> {
    const waitMs = this.registry.get(record.supplierId)?.adapter.capabilities.reconcileAfterMs ?? 0;
    const total = this.opts.reconcileDelaysMs.reduce((sum, d) => sum + d, 0);
    // The supplier wants us to wait longer than all our tries together: every
    // lookup would be skipped as "too early", so do not keep the caller waiting.
    if (waitMs > total) return record;
    let current = record;
    for (const delay of this.opts.reconcileDelaysMs) {
      if (delay > 0) await sleep(delay);
      current = await this.reconcileLocked(record.clientReference, requestId);
      if (current.status !== 'UNKNOWN') break;
    }
    return current;
  }

  /**
   * Ask the supplier what happened to one booking that is not settled:
   * UNKNOWN (did the booking go through?), ON_REQUEST (did the hotel
   * confirm?) or a cancel with an unknown outcome. Only ever reads at the
   * supplier; never re-sends a booking or a cancel.
   */
  async reconcileOne(clientReference: string, requestId: string = randomUUID()): Promise<BookingAnswer> {
    const ref = normalizeClientReference(clientReference);
    return this.locks.run(ref, async () => this.answer(await this.reconcileLocked(ref, requestId)));
  }

  private async reconcileLocked(ref: string, requestId: string): Promise<BookingRecord> {
    // Always start from the stored record, never from a copy read earlier.
    const record = await this.bookings.get(ref);
    if (!record) throw new RequestError('NOT_FOUND', 'Booking not found', 404);
    const pending = pendingKind(record);
    if (!pending) return record;

    const s = this.registry.get(record.supplierId);
    if (!s) {
      // Supplier switched off in the config since. Nothing can be checked; keep the booking as it is.
      if (this.note(record, `cannot check: supplier ${record.supplierId} is not configured`)) await this.commit(record);
      return record;
    }
    const caps = s.adapter.capabilities;
    const now = this.opts.now().getTime();
    const since = (status: BookingStatus) => Date.parse([...record.history].reverse().find((h) => h.status === status)?.at ?? record.updatedAt);

    if (pending === 'ON_REQUEST') {
      const last = record.lastCheckedAt ? Date.parse(record.lastCheckedAt) : since('ON_REQUEST');
      if (now - last < this.opts.onRequestPollIntervalMs) return record;
    } else {
      // Some suppliers answer "not found" for a while after the call (TBO: 120 s).
      const waitMs = caps.reconcileAfterMs ?? 0;
      if (waitMs > 0 && now - since(pending === 'BOOKING' ? 'UNKNOWN' : 'NEEDS_REVIEW') < waitMs) return record; // too early; the scheduler retries
      // A cancel that stays unclear is not polled forever; it waits for a person (or a cancel retry).
      if (pending === 'CANCEL' && record.reconcileAttempts >= this.opts.maxReconcileAttempts) return record;
    }

    if (!caps.lookupByClientReference && !record.supplierBookingRef) {
      if (pending === 'CANCEL') record.reconcileAttempts = this.opts.maxReconcileAttempts;
      else this.needsReview(record, 'Supplier cannot look up by our reference; check manually');
      return this.commit(record);
    }

    let found: SupplierBookingResult | null = null;
    let answered = true;
    try {
      found = await s.adapter.getBooking(this.lookupFor(record), { requestId });
    } catch (err) {
      this.note(record, `lookup failed: ${errorMessage(err)}`);
      // Only an answer from the supplier counts as an attempt.
      answered = err instanceof SupplierError && !OUR_SIDE_LOOKUP_ERRORS.has(err.code);
    }
    record.lastCheckedAt = this.iso();
    record.updatedAt = record.lastCheckedAt;

    const settled = found !== null && this.settleFromLookup(record, pending, found);
    if (!settled && answered) {
      record.reconcileAttempts += 1;
      if (pending === 'BOOKING' && record.reconcileAttempts >= this.opts.maxReconcileAttempts) {
        this.needsReview(record, 'Could not confirm with supplier; check manually before rebooking');
      } else if (pending === 'ON_REQUEST' && record.reconcileAttempts >= this.opts.maxOnRequestChecks) {
        this.needsReview(record, 'On-request booking was not answered by the hotel; check manually');
      }
    }
    return this.commit(record);
  }

  /** Apply what the supplier says about the booking. False = the answer settles nothing yet. */
  private settleFromLookup(record: BookingRecord, pending: Pending, found: SupplierBookingResult): boolean {
    const st = found.status;
    if (st === 'PENDING') return false;
    if (pending === 'ON_REQUEST' && st === 'ON_REQUEST') return false;

    if (pending === 'CANCEL') {
      if (st === 'FAILED') return false; // makes no sense for a booking that existed
      record.cancelOutcomeUnknown = undefined;
      record.reviewReason = undefined;
      record.reconcileAttempts = 0;
      this.transition(
        record,
        st,
        st === 'CANCELLED' ? 'supplier shows the booking cancelled' : 'cancel did not go through at the supplier; the booking is still active',
      );
    } else {
      if (st === 'FAILED') record.failureReason = found.message ?? 'Supplier reports the booking as failed';
      const note =
        pending === 'BOOKING' ? 'reconciled with supplier'
          : st === 'CONFIRMED' ? 'hotel confirmed the on-request booking'
            : 'hotel did not accept the on-request booking';
      if (st === 'ON_REQUEST') record.reconcileAttempts = 0; // the on-request checks get their own count
      this.transition(record, st, note);
    }
    this.applySupplierAnswer(record, found);
    return true;
  }

  /**
   * Settle everything that is waiting for a supplier answer. Runs from the
   * timer (every minute) and from POST /v1/reconcile. Single flight: while
   * a run is going, another call joins it instead of starting a second one.
   */
  reconcilePending(): Promise<BookingAnswer[]> {
    if (this.reconcileRun) return this.reconcileRun;
    const run = this.runReconcile().finally(() => {
      this.reconcileRun = undefined;
    });
    this.reconcileRun = run;
    return run;
  }

  private async runReconcile(): Promise<BookingAnswer[]> {
    const waiting = (await this.bookings.listByStatus(['UNKNOWN', 'ON_REQUEST', 'NEEDS_REVIEW'])).filter((r) => pendingKind(r) !== undefined);
    const out: BookingAnswer[] = [];
    for (const r of waiting) {
      try {
        out.push(await this.reconcileOne(r.clientReference));
      } catch (err) {
        // One booking that cannot be checked must not stop the others.
        this.opts.log(`reconcile ${r.clientReference} failed: ${errorMessage(err)}`);
      }
    }
    return out;
  }

  // ------------------------------------------------- get / cancel / resolve

  async getBooking(clientReference: string): Promise<BookingAnswer> {
    return this.answer(await this.load(normalizeClientReference(clientReference)));
  }

  private async load(ref: string): Promise<BookingRecord> {
    const r = await this.bookings.get(ref);
    if (!r) throw new RequestError('NOT_FOUND', 'Booking not found', 404);
    return r;
  }

  async cancel(clientReference: string, requestId: string = randomUUID()): Promise<BookingAnswer> {
    const ref = normalizeClientReference(clientReference);
    // Under the lock a second, parallel cancel waits, then sees CANCELLED and
    // returns: the supplier gets one cancel, not two.
    return this.locks.run(ref, async () => this.answer(await this.cancelLocked(ref, requestId)));
  }

  private async cancelLocked(ref: string, requestId: string): Promise<BookingRecord> {
    const record = await this.load(ref);
    if (record.status === 'CANCELLED') return record;
    // After a cancel with an unknown outcome the cancel may be sent again:
    // supplier cancels are idempotent, as long as we know their reference.
    const retry = record.status === 'NEEDS_REVIEW' && record.cancelOutcomeUnknown === true;
    if (record.status !== 'CONFIRMED' && record.status !== 'ON_REQUEST' && !retry) {
      throw new RequestError('NOT_CANCELLABLE', `Booking is ${record.status}`, 409);
    }
    if (retry && !record.supplierBookingRef) {
      throw new RequestError('NOT_CANCELLABLE', 'An earlier cancel has an unknown outcome and the supplier reference is not known; check with the supplier', 409);
    }
    const s = this.registry.get(record.supplierId);
    if (!s) throw new RequestError('NOT_SUPPORTED', `Supplier ${record.supplierId} is not configured; cancel manually`, 409);
    if (!s.adapter.capabilities.cancel) {
      throw new RequestError('NOT_SUPPORTED', 'Supplier does not support cancel by API; cancel manually', 409);
    }

    let sent = false;
    try {
      const res = await s.adapter.cancel(this.lookupFor(record), { requestId, onSend: () => { sent = true; } });
      if (!res.cancelled) throw new RequestError('CANCEL_REFUSED', res.message ?? 'Supplier refused the cancellation', 409);
      record.cancellationRef = res.cancellationRef;
      record.cancellationFee = res.fee;
      record.cancelOutcomeUnknown = undefined;
      if (retry) record.reviewReason = undefined;
      this.transition(record, 'CANCELLED', res.message);
      return await this.commit(record);
    } catch (err) {
      if (err instanceof RequestError) throw err;
      if (err instanceof SupplierError && !err.outcomeUnknown) throw err; // a definite "no": nothing changed
      if (!(err instanceof SupplierError) && !sent) throw err; // failed on our side before sending: nothing changed
      return this.cancelOutcomeUnknown(record, s, err, requestId);
    }
  }

  /**
   * The cancel may or may not have gone through (timeout, 5xx). Ask the
   * supplier. Cancelled: done. Still active: say so, the caller can retry.
   * No clear answer: keep it flagged; reconcile keeps asking and cancel can
   * be sent again.
   */
  private async cancelOutcomeUnknown(record: BookingRecord, s: RegisteredSupplier, cause: unknown, requestId: string): Promise<BookingRecord> {
    const caps = s.adapter.capabilities;
    let found: SupplierBookingResult | null = null;
    // A supplier that needs time before lookups are reliable is asked later, by reconcile.
    if (!caps.reconcileAfterMs && (caps.lookupByClientReference || record.supplierBookingRef)) {
      try {
        found = await s.adapter.getBooking(this.lookupFor(record), { requestId });
      } catch {
        found = null;
      }
    }
    if (found?.status === 'CANCELLED') {
      record.cancelOutcomeUnknown = undefined;
      record.reviewReason = undefined;
      this.transition(record, 'CANCELLED', 'cancel answer was lost; supplier shows the booking cancelled');
      return this.commit(record);
    }
    if (found?.status === 'CONFIRMED' || found?.status === 'ON_REQUEST') {
      record.cancelOutcomeUnknown = undefined;
      record.reviewReason = undefined;
      this.transition(record, found.status, `cancel failed (${errorMessage(cause)}); supplier still shows the booking as active`);
      await this.commit(record);
      throw new RequestError('CANCEL_NOT_DONE', 'The supplier did not confirm the cancellation and still shows the booking as active. Try again.', 409);
    }
    record.cancelOutcomeUnknown = true;
    record.reconcileAttempts = 0;
    this.needsReview(
      record,
      'Cancel outcome unknown: the supplier may or may not have cancelled. It is checked automatically; the cancel can also be sent again.',
      'CANCEL_OUTCOME_UNKNOWN',
      `cancel outcome unknown: ${errorMessage(cause)}`,
    );
    return this.commit(record);
  }

  /** A person settles a NEEDS_REVIEW booking after checking with the supplier. */
  async resolve(clientReference: string, input: ResolveRequest | unknown): Promise<BookingAnswer> {
    const ref = normalizeClientReference(clientReference);
    const req = parseResolveRequest(input);
    return this.locks.run(ref, async () => {
      const record = await this.load(ref);
      if (record.status !== 'NEEDS_REVIEW') {
        throw new RequestError('NOT_IN_REVIEW', `Booking is ${record.status}; only a NEEDS_REVIEW booking can be settled by hand`, 409);
      }
      if (req.supplierBookingRef) record.supplierBookingRef = req.supplierBookingRef;
      if (req.status === 'CONFIRMED' && !record.supplierBookingRef) {
        throw new RequestError('INVALID_REQUEST', 'supplierBookingRef is required to settle a booking as CONFIRMED (without it the booking cannot be cancelled later)', 400);
      }
      record.cancelOutcomeUnknown = undefined;
      record.reviewReason = undefined;
      if (req.status === 'FAILED') record.failureReason = `Settled by hand: ${req.note}`;
      this.transition(record, req.status, `settled by a person: ${req.note}`);
      return this.answer(await this.commit(record));
    });
  }

  // ------------------------------------------------------------- helpers

  /** `booked` is true only when the supplier confirmed: the one field a caller needs to check. */
  private answer(record: BookingRecord): BookingAnswer {
    return { ...record, booked: record.status === 'CONFIRMED' };
  }

  private lookupFor(record: BookingRecord): BookingLookup {
    return {
      clientReference: record.clientReference,
      supplierBookingRef: record.supplierBookingRef,
      hotelId: record.hotelId,
      supplierHotelCode: record.offer.supplierHotelCode,
      holderLastName: record.holder.lastName,
    };
  }

  /** Take references and the final total from a supplier answer. Never erases what we already know. */
  private applySupplierAnswer(record: BookingRecord, res: SupplierBookingResult): void {
    record.supplierBookingRef = res.supplierBookingRef ?? record.supplierBookingRef;
    record.hotelConfirmationNumber = res.hotelConfirmationNumber ?? record.hotelConfirmationNumber;
    if (res.total) record.total = res.total;
    if (record.status === 'CONFIRMED' || record.status === 'ON_REQUEST') this.checkFinalPrice(record);
  }

  /**
   * The supplier's final total is the truth and is kept. If it is above what
   * the client approved (beyond the tolerance) or in another currency, the
   * booking exists but someone must look at it before the client is charged.
   */
  private checkFinalPrice(record: BookingRecord): void {
    const approved = record.approvedTotal;
    if (!approved) return;
    let reason: string | undefined;
    let alert = '';
    if (record.total.currency !== approved.currency) {
      reason = `Supplier total is in ${record.total.currency} (${moneyToDecimal(record.total)}), the approved total was in ${approved.currency} (${moneyToDecimal(approved)}): currency differs`;
      alert = 'final supplier total is in a different currency than the approved total';
    } else if (exceedsTolerance(approved, record.total, this.opts.maxPriceIncreasePercent)) {
      reason = `Supplier total ${moneyToDecimal(record.total)} ${record.total.currency} is above the approved total ${moneyToDecimal(approved)} ${approved.currency}`;
      alert = 'final supplier total is above the approved total';
    }
    if (!reason || record.reviewReason === reason) return;
    record.reviewReason = reason;
    record.history.push({ at: this.iso(), status: record.status, note: reason });
    this.opts.alerts.send({ event: 'PRICE_MISMATCH', clientReference: record.clientReference, supplierId: record.supplierId, status: record.status, reason: alert });
  }

  /** Hand the booking to a person: status, reason on the record, alert. */
  private needsReview(record: BookingRecord, reason: string, event: AlertEvent = 'BOOKING_NEEDS_REVIEW', historyNote = reason): void {
    record.reviewReason = reason;
    this.transition(record, 'NEEDS_REVIEW', historyNote);
    // The reason is our own fixed text: no guest data leaves through an alert.
    this.opts.alerts.send({ event, clientReference: record.clientReference, supplierId: record.supplierId, status: 'NEEDS_REVIEW', reason });
  }

  /**
   * The one place a record is written. Re-reads the stored record first: a
   * copy that went stale while we waited for the supplier must never take a
   * settled booking back to "unknown", or lose the supplier's reference.
   */
  private async commit(record: BookingRecord): Promise<BookingRecord> {
    const stored = await this.bookings.get(record.clientReference);
    if (stored) {
      if (!allowedTransition(stored.status, record.status)) {
        this.opts.log(`booking ${record.clientReference}: not overwriting ${stored.status} with ${record.status} from an older copy`);
        return stored;
      }
      record.supplierBookingRef ??= stored.supplierBookingRef;
      record.hotelConfirmationNumber ??= stored.hotelConfirmationNumber;
    }
    await this.bookings.update(record);
    return record;
  }

  private checkPrice(current: Money, approved: Money): void {
    if (current.currency !== approved.currency) {
      throw new RequestError('PRICE_CHANGED', `Currency changed to ${current.currency}`, 409);
    }
    if (exceedsTolerance(approved, current, this.opts.maxPriceIncreasePercent)) {
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

  /** A history line without a status change. The same line twice in a row is written once. True when added. */
  private note(record: BookingRecord, text: string): boolean {
    if (record.history.at(-1)?.note === text) return false;
    record.history.push({ at: this.iso(), status: record.status, note: text });
    return true;
  }

  private iso(): string {
    return this.opts.now().toISOString();
  }
}

function pendingKind(r: BookingRecord): Pending | undefined {
  if (r.status === 'UNKNOWN') return 'BOOKING';
  if (r.status === 'ON_REQUEST') return 'ON_REQUEST';
  if (r.status === 'NEEDS_REVIEW' && r.cancelOutcomeUnknown) return 'CANCEL';
  return undefined;
}

/**
 * CONFIRMED, CANCELLED and FAILED are settled. A settled booking only moves
 * forward: CONFIRMED may be cancelled (or flagged when a cancel is unclear);
 * CANCELLED and FAILED never change.
 */
function allowedTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === 'CONFIRMED') return to === 'CONFIRMED' || to === 'CANCELLED' || to === 'NEEDS_REVIEW';
  if (from === 'CANCELLED' || from === 'FAILED') return to === from;
  return true;
}

/** The supplier is fine; what we sent was wrong. */
function isCallerSideError(err: unknown): boolean {
  return err instanceof RequestError || (err instanceof SupplierError && err.code === 'VALIDATION');
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

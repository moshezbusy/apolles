import type { Quote, RateOffer } from '../core/types.js';

/**
 * Offers and quotes live only for a short time (supplier prices move).
 * In production with more than one server instance, back this with Redis.
 */
export interface OfferCache {
  putOffer(offer: RateOffer, ttlMs: number): Promise<void>;
  getOffer(offerId: string): Promise<RateOffer | undefined>;
  putQuote(quote: Quote, ttlMs: number): Promise<void>;
  getQuote(quoteId: string): Promise<Quote | undefined>;
  /**
   * A quote can be booked once. Marks the quote as used by this booking
   * reference; false when another reference already took it (or the quote
   * is gone). Check and mark must be one atomic step.
   */
  claimQuote(quoteId: string, clientReference: string): Promise<boolean>;
}

interface Entry<T> {
  v: T;
  exp: number;
  claimedBy?: string;
}

export interface OfferCacheOptions {
  /** Most offers (and, separately, quotes) kept. One search can return thousands of offers. */
  maxEntries?: number;
  /** How often expired entries are removed. 0 = never (tests). */
  sweepIntervalMs?: number;
}

/**
 * Memory stays bounded two ways: a cap (when full, the oldest entry is
 * dropped, one cheap step per insert) and a periodic sweep of expired
 * entries. An insert never walks the whole cache.
 */
export class InMemoryOfferCache implements OfferCache {
  readonly maxEntries: number;
  private readonly offers = new Map<string, Entry<RateOffer>>();
  private readonly quotes = new Map<string, Entry<Quote>>();
  private readonly sweepIntervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly now: () => number = Date.now, opts: OfferCacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 20_000);
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 60_000;
  }

  /** Entries held right now, expired ones included until the next sweep. */
  get size(): number {
    return this.offers.size + this.quotes.size;
  }

  async putOffer(offer: RateOffer, ttlMs: number): Promise<void> {
    this.set(this.offers, offer.offerId, offer, ttlMs);
  }
  async getOffer(id: string): Promise<RateOffer | undefined> {
    return this.read(this.offers, id);
  }
  async putQuote(quote: Quote, ttlMs: number): Promise<void> {
    this.set(this.quotes, quote.quoteId, quote, ttlMs);
  }
  async getQuote(id: string): Promise<Quote | undefined> {
    return this.read(this.quotes, id);
  }
  async claimQuote(id: string, clientReference: string): Promise<boolean> {
    const e = this.quotes.get(id);
    if (!e || e.exp <= this.now()) return false;
    if (e.claimedBy !== undefined && e.claimedBy !== clientReference) return false;
    e.claimedBy = clientReference;
    return true;
  }

  /** Remove everything that expired. Returns how many entries went. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const map of [this.offers, this.quotes] as Map<string, Entry<unknown>>[]) {
      for (const [k, e] of map) {
        if (e.exp <= now) {
          map.delete(k);
          removed += 1;
        }
      }
    }
    return removed;
  }

  /** Stop the sweep timer (shutdown, tests). */
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private set<T>(map: Map<string, Entry<T>>, k: string, v: T, ttl: number): void {
    // A Map remembers insertion order, so its first key is the oldest entry:
    // dropping it is one step, however big the cache is.
    if (!map.has(k) && map.size >= this.maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(k, { v, exp: this.now() + ttl });
    this.startSweeping();
  }

  private read<T>(map: Map<string, Entry<T>>, k: string): T | undefined {
    const e = map.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      map.delete(k);
      return undefined;
    }
    return e.v;
  }

  /** The timer starts with the first entry and never keeps the process alive. */
  private startSweeping(): void {
    if (this.timer || this.disposed || this.sweepIntervalMs <= 0) return;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.timer.unref();
  }
}

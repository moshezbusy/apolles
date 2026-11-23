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

export class InMemoryOfferCache implements OfferCache {
  private readonly offers = new Map<string, { v: RateOffer; exp: number }>();
  private readonly quotes = new Map<string, { v: Quote; exp: number; claimedBy?: string }>();

  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 200_000) {}

  /** Stop background work (nothing yet). */
  dispose(): void {}

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

  private set<T>(map: Map<string, { v: T; exp: number }>, k: string, v: T, ttl: number): void {
    if (map.size >= this.maxEntries) this.evict(map);
    map.set(k, { v, exp: this.now() + ttl });
  }

  private read<T>(map: Map<string, { v: T; exp: number }>, k: string): T | undefined {
    const e = map.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      map.delete(k);
      return undefined;
    }
    return e.v;
  }

  private evict<T>(map: Map<string, { v: T; exp: number }>): void {
    const now = this.now();
    for (const [k, e] of map) if (e.exp <= now) map.delete(k);
    // still full: drop oldest inserted
    while (map.size >= this.maxEntries) {
      const first = map.keys().next().value;
      if (first === undefined) break;
      map.delete(first);
    }
  }
}

import { describe, expect, it } from 'vitest';
import type { Quote, RateOffer } from '../src/core/types.js';
import { InMemoryOfferCache } from '../src/store/offer-cache.js';

const offer = (id: string) => ({ offerId: id }) as RateOffer;
const quote = (id: string) => ({ quoteId: id }) as Quote;

describe('offer cache stays bounded', () => {
  it('the default cap is 20,000 entries', () => {
    expect(new InMemoryOfferCache().maxEntries).toBe(20_000);
  });

  it('when full, the oldest entry goes and the newest stays', async () => {
    const cache = new InMemoryOfferCache(() => 0, { maxEntries: 3 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) await cache.putOffer(offer(id), 1000);
    expect(cache.size).toBe(3);
    expect(await cache.getOffer('a')).toBeUndefined();
    expect(await cache.getOffer('b')).toBeUndefined();
    expect((await cache.getOffer('c'))!.offerId).toBe('c');
    expect((await cache.getOffer('e'))!.offerId).toBe('e');
  });

  it('an insert into a full cache removes exactly one entry: it never scans the whole cache', async () => {
    let now = 0;
    const cache = new InMemoryOfferCache(() => now, { maxEntries: 3 });
    for (const id of ['a', 'b', 'c']) await cache.putOffer(offer(id), 10);
    now = 100; // all three are expired now
    await cache.putOffer(offer('d'), 10);
    expect(cache.size).toBe(3); // one out, one in; the expired rest is left for the sweep
  });

  it('inserting far more than the cap is fast', async () => {
    const cache = new InMemoryOfferCache(() => 0, { maxEntries: 20_000 });
    const started = Date.now();
    for (let i = 0; i < 100_000; i++) await cache.putOffer(offer(`o${i}`), 1000);
    expect(Date.now() - started).toBeLessThan(3000); // the old full scan per insert took far longer
    expect(cache.size).toBe(20_000);
  });

  it('sweep removes expired offers and quotes', async () => {
    let now = 0;
    const cache = new InMemoryOfferCache(() => now);
    await cache.putOffer(offer('short'), 10);
    await cache.putOffer(offer('long'), 1000);
    await cache.putQuote(quote('q-short'), 10);
    now = 50;
    expect(cache.sweep()).toBe(2);
    expect(cache.size).toBe(1);
    expect((await cache.getOffer('long'))!.offerId).toBe('long');
  });

  it('sweeps by itself on a timer that does not keep the process alive', async () => {
    let now = 0;
    const cache = new InMemoryOfferCache(() => now, { sweepIntervalMs: 10 });
    await cache.putOffer(offer('a'), 10);
    now = 50;
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.size).toBe(0);
    cache.dispose();
    await cache.putOffer(offer('b'), 10);
    now = 500;
    await new Promise((r) => setTimeout(r, 40));
    expect(cache.size).toBe(1); // timer stopped: nothing swept
  });
});

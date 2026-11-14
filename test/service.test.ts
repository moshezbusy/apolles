import { describe, expect, it } from 'vitest';
import { bookReq, search, setup } from './helpers.js';

describe('search', () => {
  it('fans out to all suppliers and maps the same hotel from both', async () => {
    const { service } = setup();
    const r = await service.search(search);
    expect(r.suppliers.map((s) => s.ok)).toEqual([true, true]);
    expect(new Set(r.offers.map((o) => o.hotelId))).toEqual(new Set(['APL-1']));
    expect(new Set(r.offers.map((o) => o.supplierId))).toEqual(new Set(['alpha', 'beta']));
    // cheapest first: beta 190 x 4 nights
    expect(r.offers[0]!.supplierId).toBe('beta');
    expect(r.offers[0]!.total).toEqual({ minor: 76000, currency: 'USD' });
  });

  it('a broken or slow supplier does not break the search', async () => {
    const { service } = setup({ searchFails: true }, {}, { searchDelayMs: 1000 });
    const r = await service.search(search);
    expect(r.offers).toHaveLength(0);
    expect(r.suppliers.find((s) => s.supplierId === 'alpha')!.ok).toBe(false);
    expect(r.suppliers.find((s) => s.supplierId === 'beta')!.error).toMatch(/timed out/);
  });

  it('opens the circuit after repeated failures', async () => {
    const { service } = setup({ searchFails: true });
    for (let i = 0; i < 5; i++) await service.search(search);
    const r = await service.search(search);
    expect(r.suppliers.find((s) => s.supplierId === 'alpha')!.skipped).toBe('CIRCUIT_OPEN');
  });

  it('rejects bad input', async () => {
    const { service } = setup();
    await expect(service.search({ ...search, checkIn: '2020-01-01', checkOut: '2020-01-03' })).rejects.toThrow(/past/);
    await expect(service.search({ ...search, checkOut: search.checkIn })).rejects.toThrow(/after/);
  });
});

describe('quote and book', () => {
  async function quoted(s: ReturnType<typeof setup>, supplier = 'alpha') {
    const r = await s.service.search(search);
    const offer = r.offers.find((o) => o.supplierId === supplier)!;
    return s.service.quote(offer.offerId);
  }

  it('happy path: search, quote, book', async () => {
    const s = setup();
    const q = await quoted(s);
    expect(q.priceChanged).toBe(false);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('CONFIRMED');
    expect(b.supplierBookingRef).toMatch(/^MOCK-/);
  });

  it('same clientReference twice books only once', async () => {
    const s = setup();
    const q = await quoted(s);
    const [x, y] = await Promise.all([
      s.service.book(bookReq(q.quoteId, q.offer.total)),
      s.service.book(bookReq(q.quoteId, q.offer.total)),
    ]);
    expect(x.clientReference).toBe(y.clientReference);
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
  });

  it('price went up after approval: refuse to book', async () => {
    const s = setup({ priceIncreasePercent: 5 });
    const r = await s.service.search(search);
    const offer = r.offers.find((o) => o.supplierId === 'alpha')!;
    const q = await s.service.quote(offer.offerId);
    expect(q.priceChanged).toBe(true);
    await expect(s.service.book(bookReq(q.quoteId, offer.total))).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(s.a.calls).not.toContain('book');
  });

  it('price tolerance allows small increases when configured', async () => {
    const s = setup({ priceIncreasePercent: 1 }, { maxPriceIncreasePercent: 2 });
    const r = await s.service.search(search);
    const offer = r.offers.find((o) => o.supplierId === 'alpha')!;
    const q = await s.service.quote(offer.offerId);
    const b = await s.service.book(bookReq(q.quoteId, offer.total));
    expect(b.status).toBe('CONFIRMED');
  });

  it('sold out on re-check', async () => {
    const s = setup({ soldOutOnCheck: true });
    const r = await s.service.search(search);
    await expect(s.service.quote(r.offers.find((o) => o.supplierId === 'alpha')!.offerId)).rejects.toMatchObject({ code: 'SOLD_OUT' });
  });

  it('timeout but the supplier DID book: reconciled to CONFIRMED, never booked twice', async () => {
    const s = setup({ timeoutButBooked: true });
    const q = await quoted(s);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('CONFIRMED');
    expect(b.supplierBookingRef).toMatch(/^MOCK-/);
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
    expect(b.history.map((h) => h.status)).toEqual(['PENDING', 'UNKNOWN', 'CONFIRMED']);
  });

  it('timeout and NOT booked: ends in NEEDS_REVIEW, never auto-rebooked', async () => {
    const s = setup({ timeoutNotBooked: true });
    const q = await quoted(s);
    let b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('UNKNOWN');
    await s.service.reconcilePending();
    b = await s.service.getBooking(b.clientReference);
    expect(b.status).toBe('NEEDS_REVIEW');
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
  });

  it('supplier refuses: FAILED', async () => {
    const s = setup({ rejectBooking: true });
    const q = await quoted(s);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('FAILED');
  });

  it('guests must match the searched rooms', async () => {
    const s = setup();
    const q = await quoted(s);
    const req = bookReq(q.quoteId, q.offer.total);
    req.guests = [[req.guests[0]![0]!]];
    await expect(s.service.book(req)).rejects.toThrow(/occupancy/);
  });

  it('refuses a raw card number anywhere in the request', async () => {
    const s = setup();
    const q = await quoted(s);
    const req = bookReq(q.quoteId, q.offer.total);
    req.specialRequests = 'pay with 4111 1111 1111 1111';
    await expect(s.service.book(req)).rejects.toThrow(/card number/);
  });

  it('cancel', async () => {
    const s = setup();
    const q = await quoted(s);
    await s.service.book(bookReq(q.quoteId, q.offer.total));
    const c = await s.service.cancel('APL-BK-0001');
    expect(c.status).toBe('CANCELLED');
    expect(c.cancellationRef).toMatch(/^CXL-/);
  });

  it('expired quote cannot be booked', async () => {
    const s = setup({}, { quoteTtlMs: -1 });
    const q = await quoted(s);
    await expect(s.service.book(bookReq(q.quoteId, q.offer.total))).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  });
});

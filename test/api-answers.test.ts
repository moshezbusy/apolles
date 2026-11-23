import { describe, expect, it } from 'vitest';
import { bookReq, search, setup } from './helpers.js';

async function quoted(s: ReturnType<typeof setup>, supplier = 'alpha') {
  const r = await s.service.search(search);
  const offer = r.offers.find((o) => o.supplierId === supplier)!;
  return s.service.quote(offer.offerId);
}

describe('answers say plainly whether a real booking exists', () => {
  it('booked is true only for CONFIRMED; environment is on every answer', async () => {
    const s = setup();
    const r = await s.service.search(search);
    expect(r.offers.every((o) => o.environment === 'test')).toBe(true);
    const q = await s.service.quote(r.offers[0]!.offerId);
    expect(q.environment).toBe('test');
    expect(q.offer.environment).toBe('test');
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b).toMatchObject({ status: 'CONFIRMED', booked: true, environment: 'test' });
    expect(await s.service.getBooking('APL-BK-0001')).toMatchObject({ booked: true, environment: 'test' });
    expect(await s.service.cancel('APL-BK-0001')).toMatchObject({ status: 'CANCELLED', booked: false, environment: 'test' });
  });

  it('FAILED and UNKNOWN are never "booked"', async () => {
    const failed = setup({ rejectBooking: true });
    let q = await quoted(failed);
    expect(await failed.service.book(bookReq(q.quoteId, q.offer.total))).toMatchObject({ status: 'FAILED', booked: false });
    const unknown = setup({ timeoutNotBooked: true });
    q = await quoted(unknown);
    expect(await unknown.service.book(bookReq(q.quoteId, q.offer.total))).toMatchObject({ status: 'UNKNOWN', booked: false });
  });

  it('a production supplier is marked production', async () => {
    const s = setup();
    (s.a as { environment: string }).environment = 'production';
    const q = await quoted(s);
    expect(q.environment).toBe('production');
    expect((await s.service.book(bookReq(q.quoteId, q.offer.total))).environment).toBe('production');
  });
});

describe('one reference, one quote, one booking', () => {
  it('replaying a reference with the same quote returns the same booking', async () => {
    const s = setup();
    const q = await quoted(s);
    const first = await s.service.book(bookReq(q.quoteId, q.offer.total));
    const again = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(again.supplierBookingRef).toBe(first.supplierBookingRef);
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
  });

  it('replaying a reference with a DIFFERENT quote is refused with 409', async () => {
    const s = setup();
    const q1 = await quoted(s);
    const q2 = await quoted(s);
    await s.service.book(bookReq(q1.quoteId, q1.offer.total));
    await expect(s.service.book(bookReq(q2.quoteId, q2.offer.total))).rejects.toMatchObject({ status: 409, code: 'REFERENCE_REUSED' });
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
  });

  it('a quote can be booked once: a second reference is refused', async () => {
    const s = setup();
    const q = await quoted(s);
    await s.service.book(bookReq(q.quoteId, q.offer.total, 'APL-BK-0001'));
    await expect(s.service.book(bookReq(q.quoteId, q.offer.total, 'APL-BK-0002'))).rejects.toMatchObject({ status: 409, code: 'QUOTE_ALREADY_USED' });
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
    await expect(s.service.getBooking('APL-BK-0002')).rejects.toMatchObject({ status: 404 });
  });

  it('two references racing for one quote: exactly one booking reaches the supplier', async () => {
    const s = setup();
    const q = await quoted(s);
    const results = await Promise.allSettled([
      s.service.book(bookReq(q.quoteId, q.offer.total, 'APL-BK-0001')),
      s.service.book(bookReq(q.quoteId, q.offer.total, 'APL-BK-0002')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(s.a.calls.filter((c) => c === 'book')).toHaveLength(1);
  });
});

describe('an error on our side before anything was sent', () => {
  it('is FAILED (nothing was sent), not UNKNOWN', async () => {
    const s = setup({ localErrorBeforeSend: true });
    const q = await quoted(s);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('FAILED');
    expect(b.failureReason).toMatch(/not sent/i);
    expect(s.a.calls).not.toContain('getBooking'); // nothing to reconcile
  });

  it('an unexpected error AFTER sending stays UNKNOWN and is reconciled', async () => {
    const s = setup({ crashAfterSend: true });
    const q = await quoted(s);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    // the mock did store the booking, so the lookup finds it
    expect(b.status).toBe('CONFIRMED');
    expect(b.history.map((h) => h.status)).toEqual(['PENDING', 'UNKNOWN', 'CONFIRMED']);
  });
});

import { describe, expect, it } from 'vitest';
import { booked, bookReq, quoted, setup } from './helpers.js';

describe('price after booking', () => {
  it('supplier total above the approved total: supplier truth kept, marked for review, alert sent', async () => {
    const s = setup({ bookTotalIncreasePercent: 10 });
    const q = await quoted(s);
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(b.status).toBe('CONFIRMED'); // the booking exists; that is the truth
    expect(b.total).toEqual({ minor: 88000, currency: 'USD' });
    expect(b.approvedTotal).toEqual({ minor: 80000, currency: 'USD' });
    expect(b.reviewReason).toMatch(/above the approved/i);
    expect(s.alerts.alerts).toEqual([expect.objectContaining({ event: 'PRICE_MISMATCH', clientReference: 'APL-BK-0001', supplierId: 'alpha', status: 'CONFIRMED' })]);
    expect((await s.service.getBooking('APL-BK-0001')).reviewReason).toMatch(/above the approved/i);
  });

  it('supplier answers in another currency: marked for review', async () => {
    const s = setup({ bookCurrency: 'EUR' });
    const b = await booked(s);
    expect(b.total.currency).toBe('EUR');
    expect(b.reviewReason).toMatch(/currency/i);
    expect(s.alerts.alerts.map((a) => a.event)).toEqual(['PRICE_MISMATCH']);
  });

  it('an increase inside the allowed tolerance is not flagged', async () => {
    const s = setup({ bookTotalIncreasePercent: 2 }, { maxPriceIncreasePercent: 2 });
    const b = await booked(s);
    expect(b.status).toBe('CONFIRMED');
    expect(b.reviewReason).toBeUndefined();
    expect(s.alerts.alerts).toHaveLength(0);
  });

  it('a mismatch found later by reconcile is flagged too', async () => {
    const s = setup({ timeoutButBooked: true, bookTotalIncreasePercent: 10 });
    const b = await booked(s);
    expect(b.status).toBe('CONFIRMED');
    expect(b.reviewReason).toMatch(/above the approved/i);
    expect(s.alerts.alerts.map((a) => a.event)).toEqual(['PRICE_MISMATCH']);
  });
});

describe('alerts', () => {
  it('a booking that ends in NEEDS_REVIEW raises an alert without guest data', async () => {
    const s = setup({ timeoutNotBooked: true });
    await booked(s);
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.reviewReason).toMatch(/check/i);
    expect(s.alerts.alerts).toEqual([{
      event: 'BOOKING_NEEDS_REVIEW', clientReference: 'APL-BK-0001', supplierId: 'alpha', status: 'NEEDS_REVIEW',
      reason: expect.any(String),
    }]);
    expect(JSON.stringify(s.alerts.alerts)).not.toMatch(/Levi|Dana|dana@example/);
  });
});

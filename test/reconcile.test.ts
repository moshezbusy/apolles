import { describe, expect, it } from 'vitest';
import { MockSupplierAdapter } from '../src/adapters/mock/mock-adapter.js';
import type { BookingLookup, SupplierBookingResult } from '../src/core/supplier.js';
import { booked, bookReq, deferred, quoted, setup, tick } from './helpers.js';

/** A mock whose lookups can be held "in flight", and can run a hook mid-lookup. */
class GatedMock extends MockSupplierAdapter {
  gate: Promise<void> | undefined;
  duringLookup: (() => Promise<void>) | undefined;
  override async getBooking(ref: BookingLookup): Promise<SupplierBookingResult | null> {
    this.calls.push('getBooking:start');
    await this.gate;
    await this.duringLookup?.();
    return super.getBooking(ref);
  }
}
const gated = () => {
  let mock!: GatedMock;
  const make = (hotels: ConstructorParameters<typeof MockSupplierAdapter>[1], sc: ConstructorParameters<typeof MockSupplierAdapter>[2]) => (mock = new GatedMock('alpha', hotels, sc));
  return { make, get mock() { return mock; } };
};

describe('overlapping reconcile runs', () => {
  it('a second run while one is running joins it: one lookup, not two', async () => {
    const g = gated();
    const s = setup({ timeoutButBooked: true }, { reconcileDelaysMs: [] }, undefined, g.make);
    expect((await booked(s)).status).toBe('UNKNOWN');

    const gate = deferred();
    g.mock.gate = gate.promise;
    const first = s.service.reconcilePending();
    await tick();
    const second = s.service.reconcilePending(); // the timer fires again, or POST /v1/reconcile arrives
    const third = s.service.reconcileOne('APL-BK-0001');
    await tick();
    gate.resolve();
    const [a, b, c] = await Promise.all([first, second, third]);

    expect(g.mock.calls.filter((x) => x === 'getBooking')).toHaveLength(1);
    expect(a[0]!.status).toBe('CONFIRMED');
    expect(b[0]!.status).toBe('CONFIRMED');
    expect(c.status).toBe('CONFIRMED');
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.history.map((h) => h.status)).toEqual(['PENDING', 'UNKNOWN', 'CONFIRMED']);
  });

  it('a stale copy never downgrades a settled booking or erases the supplier reference', async () => {
    const g = gated();
    const s = setup({ timeoutNotBooked: true }, { reconcileDelaysMs: [] }, undefined, g.make);
    await booked(s);
    // While our lookup is in flight (it will say "not found"), another writer
    // settles the booking as CONFIRMED with the supplier's reference.
    g.mock.duringLookup = async () => {
      const r = (await s.store.get('APL-BK-0001'))!;
      await s.store.update({ ...r, status: 'CONFIRMED', supplierBookingRef: 'SUP-REAL-1' });
    };
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.status).toBe('CONFIRMED');
    expect(r.supplierBookingRef).toBe('SUP-REAL-1');
  });

  it('reconcile and cancel of one booking run one after the other, never interleaved', async () => {
    const g = gated();
    const s = setup({ bookOnRequest: true }, { onRequestPollIntervalMs: 0 }, undefined, g.make);
    expect((await booked(s)).status).toBe('ON_REQUEST');
    const gate = deferred();
    g.mock.gate = gate.promise;
    const run = s.service.reconcilePending(); // lookup in flight: supplier still says ON_REQUEST
    await tick();
    const cancel = s.service.cancel('APL-BK-0001');
    await tick();
    expect(g.mock.calls).not.toContain('cancel'); // waits for the lookup to finish
    gate.resolve();
    await Promise.all([run, cancel]);
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.status).toBe('CANCELLED'); // the older lookup result did not overwrite the cancel
    expect(g.mock.calls.filter((x) => x === 'cancel')).toHaveLength(1);
  });

  it('one booking that cannot be checked does not stop the others', async () => {
    const s = setup({ timeoutButBooked: true }, { reconcileDelaysMs: [] });
    await booked(s, 'APL-BK-0001');
    // A booking of a supplier that is no longer configured (disabled since).
    const orphan = (await s.store.get('APL-BK-0001'))!;
    await s.store.create({ ...orphan, clientReference: 'APL-BK-GONE', supplierId: 'removed-supplier' });
    await s.service.reconcilePending();
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('CONFIRMED');
    expect((await s.service.getBooking('APL-BK-GONE')).status).toBe('UNKNOWN');
  });
});

describe('immediate check after an unknown booking outcome', () => {
  it('does not make the caller wait when the supplier forbids early lookups', async () => {
    const s = setup({ timeoutButBooked: true }, { reconcileDelaysMs: [300, 300] });
    (s.a.capabilities as { reconcileAfterMs?: number }).reconcileAfterMs = 120_000;
    const q = await quoted(s);
    const started = Date.now();
    const b = await s.service.book(bookReq(q.quoteId, q.offer.total));
    expect(Date.now() - started).toBeLessThan(250);
    expect(b.status).toBe('UNKNOWN');
    expect(s.a.calls).not.toContain('getBooking');
  });
});

describe('stuck states', () => {
  it('ON_REQUEST bookings are polled until the hotel confirms', async () => {
    let now = new Date('2026-11-14T10:00:00Z');
    const s = setup({ bookOnRequest: true }, { now: () => now, onRequestPollIntervalMs: 15 * 60_000 });
    expect((await booked(s)).status).toBe('ON_REQUEST');

    await s.service.reconcilePending(); // too soon: not polled every minute
    expect(s.a.calls).not.toContain('getBooking');

    now = new Date(now.getTime() + 16 * 60_000);
    await s.service.reconcilePending(); // still on request at the supplier
    expect(s.a.calls.filter((c) => c === 'getBooking')).toHaveLength(1);
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('ON_REQUEST');

    s.a.bookings.get('APL-BK-0001')!.status = 'CONFIRMED';
    now = new Date(now.getTime() + 16 * 60_000);
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r).toMatchObject({ status: 'CONFIRMED', booked: true });
  });

  it('an ON_REQUEST booking the hotel rejects ends as the supplier says', async () => {
    const s = setup({ bookOnRequest: true }, { onRequestPollIntervalMs: 0 });
    await booked(s);
    s.a.bookings.get('APL-BK-0001')!.status = 'CANCELLED';
    await s.service.reconcilePending();
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('CANCELLED');
  });

  it('ON_REQUEST polling has a cap: then a person is asked', async () => {
    const s = setup({ bookOnRequest: true }, { onRequestPollIntervalMs: 0, maxOnRequestChecks: 2 });
    await booked(s);
    await s.service.reconcilePending();
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.reviewReason).toMatch(/on.request/i);
    expect(s.alerts.alerts.map((a) => a.event)).toContain('BOOKING_NEEDS_REVIEW');
  });

  it('lookup failures on our own side do not use up the attempts', async () => {
    for (const lookupError of ['LOCAL', 'RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT', 'AUTH'] as const) {
      const s = setup({ timeoutNotBooked: true }, { reconcileDelaysMs: [], maxReconcileAttempts: 3 });
      await booked(s);
      s.a.scenario.lookupError = lookupError;
      for (let i = 0; i < 6; i++) await s.service.reconcilePending();
      let r = await s.service.getBooking('APL-BK-0001');
      expect(r.status, lookupError).toBe('UNKNOWN');
      expect(r.reconcileAttempts, lookupError).toBe(0);
      // six identical failures are one line in the history, not six
      expect(r.history.filter((h) => /lookup failed/.test(h.note ?? '')), lookupError).toHaveLength(1);

      // The connection is back and the supplier really answers "not found": now it counts.
      s.a.scenario.lookupError = undefined;
      for (let i = 0; i < 3; i++) await s.service.reconcilePending();
      r = await s.service.getBooking('APL-BK-0001');
      expect(r.status, lookupError).toBe('NEEDS_REVIEW');
    }
  });
});

describe('settling a NEEDS_REVIEW booking by hand', () => {
  async function inReview() {
    const s = setup({ timeoutNotBooked: true }, { reconcileDelaysMs: [], maxReconcileAttempts: 1 });
    await booked(s);
    await s.service.reconcilePending();
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('NEEDS_REVIEW');
    return s;
  }

  it('a person confirms it after checking with the supplier; the note is kept', async () => {
    const s = await inReview();
    const r = await s.service.resolve('apl-bk-0001', { status: 'CONFIRMED', note: 'Called the hotel, booked under Levi', supplierBookingRef: 'HTL-7781' });
    expect(r).toMatchObject({ status: 'CONFIRMED', booked: true, supplierBookingRef: 'HTL-7781' });
    expect(r.reviewReason).toBeUndefined();
    expect(r.history.at(-1)).toMatchObject({ status: 'CONFIRMED', note: expect.stringContaining('Called the hotel, booked under Levi') });
  });

  it('or marks it FAILED / CANCELLED', async () => {
    const failed = await (await inReview()).service.resolve('APL-BK-0001', { status: 'FAILED', note: 'Supplier has no such booking' });
    expect(failed).toMatchObject({ status: 'FAILED', booked: false });
    const cancelled = await (await inReview()).service.resolve('APL-BK-0001', { status: 'CANCELLED', note: 'Cancelled by phone' });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('refuses bad input and bookings that are not in review', async () => {
    const s = await inReview();
    await expect(s.service.resolve('APL-BK-0001', { status: 'CONFIRMED', note: 'no reference given' })).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-0001', { status: 'PENDING', note: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-0001', { status: 'FAILED' })).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-0001', { status: 'FAILED', note: 'card 4111 1111 1111 1111' })).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-0001', { status: 'FAILED', note: 'x', extra: 1 })).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-0001', null)).rejects.toMatchObject({ status: 400 });
    await expect(s.service.resolve('APL-BK-9999', { status: 'FAILED', note: 'x' })).rejects.toMatchObject({ status: 404 });

    const ok = setup();
    await booked(ok);
    await expect(ok.service.resolve('APL-BK-0001', { status: 'FAILED', note: 'x' })).rejects.toMatchObject({ status: 409, code: 'NOT_IN_REVIEW' });
  });
});

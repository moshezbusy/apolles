import { describe, expect, it } from 'vitest';
import { booked, setup } from './helpers.js';

describe('cancel with an unknown outcome', () => {
  it('answer lost but the supplier did cancel: looked up and settled as CANCELLED', async () => {
    const s = setup({ cancelUnknownButCancelled: true });
    await booked(s);
    const c = await s.service.cancel('APL-BK-0001');
    expect(c).toMatchObject({ status: 'CANCELLED', booked: false });
    expect(s.a.calls.filter((x) => x === 'cancel')).toHaveLength(1);
    expect(s.a.calls).toContain('getBooking');
  });

  it('answer lost and the supplier still shows it active: stays CONFIRMED, caller is told, cancel can be retried', async () => {
    const s = setup({ cancelUnknownNotCancelled: true });
    await booked(s);
    await expect(s.service.cancel('APL-BK-0001')).rejects.toMatchObject({ status: 409, code: 'CANCEL_NOT_DONE' });
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r).toMatchObject({ status: 'CONFIRMED', booked: true });
    expect(r.history.at(-1)!.note).toMatch(/still shows/i);

    s.a.scenario.cancelUnknownNotCancelled = false; // supplier is back
    expect((await s.service.cancel('APL-BK-0001')).status).toBe('CANCELLED');
  });

  it('still unclear (the lookup fails too): flagged for review, alert sent, and cancel can be retried', async () => {
    const s = setup({ cancelUnknownNotCancelled: true, lookupError: 'UNAVAILABLE' });
    await booked(s);
    const c = await s.service.cancel('APL-BK-0001');
    expect(c).toMatchObject({ status: 'NEEDS_REVIEW', booked: false, cancelOutcomeUnknown: true });
    expect(c.reviewReason).toMatch(/cancel/i);
    expect(s.alerts.alerts).toEqual([expect.objectContaining({ event: 'CANCEL_OUTCOME_UNKNOWN', clientReference: 'APL-BK-0001', supplierId: 'alpha' })]);
    // no guest data in the alert
    expect(JSON.stringify(s.alerts.alerts)).not.toMatch(/Levi|Dana|dana@example/);

    // Not a dead end: the supplier reference is known, cancels are idempotent, so try again.
    s.a.scenario = {};
    const again = await s.service.cancel('APL-BK-0001');
    expect(again.status).toBe('CANCELLED');
    expect(again.cancelOutcomeUnknown).toBeUndefined();
    expect(again.reviewReason).toBeUndefined();
  });

  it('still unclear: reconcile keeps checking and settles it when the supplier shows it cancelled', async () => {
    const s = setup({ cancelUnknownButCancelled: true, lookupError: 'TIMEOUT' });
    await booked(s);
    expect((await s.service.cancel('APL-BK-0001')).status).toBe('NEEDS_REVIEW');
    await s.service.reconcilePending(); // supplier still unreachable
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('NEEDS_REVIEW');
    s.a.scenario.lookupError = undefined;
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r.status).toBe('CANCELLED');
    expect(r.cancelOutcomeUnknown).toBeUndefined();
    expect(s.a.calls.filter((x) => x === 'cancel')).toHaveLength(1); // reconcile never re-sends the cancel
  });

  it('still unclear: reconcile puts it back to CONFIRMED when the supplier shows it active', async () => {
    const s = setup({ cancelUnknownNotCancelled: true, lookupError: 'TIMEOUT' });
    await booked(s);
    await s.service.cancel('APL-BK-0001');
    s.a.scenario.lookupError = undefined;
    await s.service.reconcilePending();
    const r = await s.service.getBooking('APL-BK-0001');
    expect(r).toMatchObject({ status: 'CONFIRMED', booked: true });
    expect(r.cancelOutcomeUnknown).toBeUndefined();
  });

  it('a supplier that forbids early lookups is asked later, by reconcile', async () => {
    let now = new Date('2026-11-14T10:00:00Z');
    const s = setup({ cancelUnknownButCancelled: true }, { now: () => now });
    await booked(s);
    (s.a.capabilities as { reconcileAfterMs?: number }).reconcileAfterMs = 120_000;
    const c = await s.service.cancel('APL-BK-0001');
    expect(c.status).toBe('NEEDS_REVIEW');
    expect(s.a.calls).not.toContain('getBooking');
    await s.service.reconcilePending(); // too early
    expect(s.a.calls).not.toContain('getBooking');
    now = new Date(now.getTime() + 121_000);
    await s.service.reconcilePending();
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('CANCELLED');
  });

  it('a definite refusal changes nothing', async () => {
    const s = setup();
    await booked(s);
    s.a.bookings.delete('APL-BK-0001'); // the mock now answers NOT_FOUND
    await expect(s.service.cancel('APL-BK-0001')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await s.service.getBooking('APL-BK-0001')).status).toBe('CONFIRMED');
  });
});

describe('parallel cancels', () => {
  it('two cancels of one booking reach the supplier once', async () => {
    const s = setup();
    await booked(s);
    const [a, b] = await Promise.all([s.service.cancel('APL-BK-0001'), s.service.cancel('apl-bk-0001')]);
    expect(a.status).toBe('CANCELLED');
    expect(b.status).toBe('CANCELLED');
    expect(s.a.calls.filter((x) => x === 'cancel')).toHaveLength(1);
  });

  it('a booking that is not confirmed cannot be cancelled', async () => {
    const s = setup({ rejectBooking: true });
    await booked(s);
    await expect(s.service.cancel('APL-BK-0001')).rejects.toMatchObject({ status: 409, code: 'NOT_CANCELLABLE' });
  });
});

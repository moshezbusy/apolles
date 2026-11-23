import { describe, expect, it } from 'vitest';
import { NullAlertSink, WebhookAlertSink, alertSinkFromEnv } from '../src/alerts/alerts.js';

function capture(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('ok', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('alert webhook', () => {
  it('posts a small JSON with no guest data', async () => {
    const { calls, fetchImpl } = capture();
    const sink = new WebhookAlertSink('https://hooks.example/alert', { fetchImpl, now: () => new Date('2026-11-14T10:00:00Z') });
    // Extra fields (as a careless caller might pass) must not leave the building.
    sink.send({ event: 'BOOKING_NEEDS_REVIEW', clientReference: 'APL-BK-0001', supplierId: 'alpha', status: 'NEEDS_REVIEW', reason: 'could not confirm', holder: { lastName: 'Levi' } } as never);
    await sink.idle();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://hooks.example/alert');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.redirect).toBe('error');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      service: 'apolles-suppliers', at: '2026-11-14T10:00:00.000Z', event: 'BOOKING_NEEDS_REVIEW',
      clientReference: 'APL-BK-0001', supplierId: 'alpha', status: 'NEEDS_REVIEW', reason: 'could not confirm',
    });
  });

  it('a failing webhook is logged, never thrown', async () => {
    const logged: string[] = [];
    const boom = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const sink = new WebhookAlertSink('https://hooks.example/alert', { fetchImpl: boom, log: (m) => logged.push(m) });
    expect(() => sink.send({ event: 'PRICE_MISMATCH', reason: 'x' })).not.toThrow();
    await sink.idle();
    expect(logged.join('\n')).toMatch(/alert.*not sent.*fetch failed/i);

    const logged2: string[] = [];
    const sink2 = new WebhookAlertSink('https://hooks.example/alert', { fetchImpl: capture(500).fetchImpl, log: (m) => logged2.push(m) });
    sink2.send({ event: 'PRICE_MISMATCH', reason: 'x' });
    await sink2.idle();
    expect(logged2.join('\n')).toMatch(/HTTP 500/);
  });

  it('only https is accepted', () => {
    expect(() => new WebhookAlertSink('http://hooks.example/alert')).toThrow(/https/);
    expect(() => new WebhookAlertSink('not a url')).toThrow(/https/);
    expect(() => alertSinkFromEnv({ ALERT_WEBHOOK_URL: 'http://hooks.example/a' })).toThrow(/ALERT_WEBHOOK_URL/);
  });

  it('is optional: no URL, no alerts', () => {
    expect(alertSinkFromEnv({})).toBeInstanceOf(NullAlertSink);
    expect(alertSinkFromEnv({ ALERT_WEBHOOK_URL: 'https://hooks.example/a' })).toBeInstanceOf(WebhookAlertSink);
  });
});

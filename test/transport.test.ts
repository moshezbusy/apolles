import { describe, expect, it } from 'vitest';
import { HttpTransport } from '../src/http/transport.js';
import { InMemoryAuditSink } from '../src/audit/audit.js';
import { SupplierError } from '../src/core/errors.js';

function fakeFetch(responses: Array<number | 'hang' | 'neterr'>) {
  let i = 0;
  const calls: number[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const r = responses[Math.min(i, responses.length - 1)];
    calls.push(++i);
    if (r === 'neterr') throw new TypeError('fetch failed');
    if (r === 'hang') {
      return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    }
    return new Response('<ok/>', { status: r });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = { method: 'POST' as const, url: 'https://supplier.example/ota', body: '<x/>', timeoutMs: 50 };

describe('transport', () => {
  it('retries idempotent calls on 5xx', async () => {
    const f = fakeFetch([503, 503, 200]);
    const t = new HttpTransport({ supplierId: 's', fetchImpl: f.impl, baseDelayMs: 1 });
    const res = await t.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' });
    expect(res.status).toBe(200);
    expect(f.calls.length).toBe(3);
  });

  it('never retries a booking; a timeout becomes OUTCOME_UNKNOWN', async () => {
    const f = fakeFetch(['hang']);
    const t = new HttpTransport({ supplierId: 's', fetchImpl: f.impl, baseDelayMs: 1 });
    const err = await t.send({ ...base, operation: 'book', idempotent: false }, { requestId: 'r' }).catch((e) => e);
    expect(err).toBeInstanceOf(SupplierError);
    expect((err as SupplierError).code).toBe('OUTCOME_UNKNOWN');
    expect(f.calls.length).toBe(1);
  });

  it('a 500 on booking is OUTCOME_UNKNOWN, not failed', async () => {
    const f = fakeFetch([500]);
    const t = new HttpTransport({ supplierId: 's', fetchImpl: f.impl });
    const err = (await t.send({ ...base, operation: 'book', idempotent: false }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('OUTCOME_UNKNOWN');
    expect(f.calls.length).toBe(1);
  });

  it('auth errors are not retried', async () => {
    const f = fakeFetch([401]);
    const t = new HttpTransport({ supplierId: 's', fetchImpl: f.impl });
    const err = (await t.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('AUTH');
    expect(f.calls.length).toBe(1);
  });

  it('refuses plain http to remote hosts', async () => {
    const t = new HttpTransport({ supplierId: 's', fetchImpl: fakeFetch([200]).impl });
    await expect(t.send({ ...base, url: 'http://supplier.example/', operation: 'search', idempotent: true }, { requestId: 'r' })).rejects.toThrow(/HTTPS/);
  });

  it('writes a redacted audit entry per attempt', async () => {
    const audit = new InMemoryAuditSink();
    const t = new HttpTransport({ supplierId: 's', fetchImpl: fakeFetch([200]).impl, audit });
    await t.send({ ...base, body: '<PaymentCard CardNumber="4111111111111111"/>', operation: 'book', idempotent: false, headers: { authorization: 'Basic x' } }, { requestId: 'r1' });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.requestBody).not.toContain('4111111111111111');
    expect(audit.entries[0]!.requestHeaders['authorization']).toBe('***');
    expect(audit.entries[0]!.requestId).toBe('r1');
  });
});

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

describe('transport: redirects are refused', () => {
  async function redirecting(): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
    const { createServer } = await import('node:http');
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as import('node:net').AddressInfo;
    return { url: `http://127.0.0.1:${port}/ota`, hits: () => hits, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it('a redirect on a read is a normal supplier error and is not followed or retried', async () => {
    const srv = await redirecting();
    try {
      const t = new HttpTransport({ supplierId: 's', baseDelayMs: 1 }); // real fetch
      const err = (await t.send({ ...base, url: srv.url, timeoutMs: 2000, operation: 'search', idempotent: true }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
      expect(err).toBeInstanceOf(SupplierError);
      expect(err.code).toBe('PROTOCOL');
      expect(err.message).toMatch(/redirect/i);
      expect(srv.hits()).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('a redirect on book is OUTCOME_UNKNOWN', async () => {
    const srv = await redirecting();
    try {
      const t = new HttpTransport({ supplierId: 's', baseDelayMs: 1 });
      const err = (await t.send({ ...base, url: srv.url, timeoutMs: 2000, operation: 'book', idempotent: false }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
      expect(err.code).toBe('OUTCOME_UNKNOWN');
      expect(srv.hits()).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it('asks fetch not to follow redirects, and refuses a 3xx answer it is handed anyway', async () => {
    let seen: RequestInit | undefined;
    const impl = (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(null, { status: 301, headers: { location: 'https://evil.example/' } });
    }) as unknown as typeof fetch;
    const t = new HttpTransport({ supplierId: 's', fetchImpl: impl, baseDelayMs: 1 });
    const read = (await t.send({ ...base, operation: 'getBooking', idempotent: true }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(seen!.redirect).toBe('error');
    expect(read.code).toBe('PROTOCOL');
    const book = (await t.send({ ...base, operation: 'book', idempotent: false }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(book.code).toBe('OUTCOME_UNKNOWN');
  });
});

describe('transport: oversized answers', () => {
  /** A body that streams 1 KB chunks for ever, with no content-length. Counts what was actually pulled. */
  function endless() {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024).fill(120));
      },
    });
    const impl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    return { impl, pulled: () => pulled };
  }

  it('stops reading once the limit is passed (no content-length needed)', async () => {
    const f = endless();
    const t = new HttpTransport({ supplierId: 's', fetchImpl: f.impl, maxResponseBytes: 10 * 1024, baseDelayMs: 1 });
    const err = (await t.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('PROTOCOL');
    expect(err.message).toMatch(/too large/);
    expect(f.pulled()).toBeLessThan(20); // about 11 KB read, not the whole stream
  });

  it('an oversized answer to book is OUTCOME_UNKNOWN', async () => {
    const t = new HttpTransport({ supplierId: 's', fetchImpl: endless().impl, maxResponseBytes: 10 * 1024 });
    const err = (await t.send({ ...base, operation: 'book', idempotent: false }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('OUTCOME_UNKNOWN');
  });

  it('counts bytes, not characters', async () => {
    const impl = (async () => new Response('é'.repeat(7), { status: 200 })) as unknown as typeof fetch; // 7 characters, 14 bytes
    const small = new HttpTransport({ supplierId: 's', fetchImpl: impl, maxResponseBytes: 10 });
    await expect(small.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' })).rejects.toThrow(/too large/);
    const enough = new HttpTransport({ supplierId: 's', fetchImpl: impl, maxResponseBytes: 14 });
    expect((await enough.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' })).body).toBe('é'.repeat(7));
  });

  it('a declared content-length above the limit is refused without reading', async () => {
    const impl = (async () => new Response('x', { status: 200, headers: { 'content-length': '999999' } })) as unknown as typeof fetch;
    const t = new HttpTransport({ supplierId: 's', fetchImpl: impl, maxResponseBytes: 100 });
    await expect(t.send({ ...base, operation: 'search', idempotent: true }, { requestId: 'r' })).rejects.toThrow(/too large/);
  });
});

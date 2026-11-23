import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuditSink, JsonlFileAuditSink, MonitoredAuditSink, type AuditEntry, type AuditSink } from '../src/audit/audit.js';
import { HttpTransport } from '../src/http/transport.js';

const entry = (at = '2026-11-14T10:00:00.000Z'): AuditEntry => ({
  at, requestId: 'r', supplierId: 's', operation: 'search', attempt: 1, method: 'POST', url: 'https://x/', requestHeaders: {}, durationMs: 1,
});
const tempDir = () => mkdtemp(join(tmpdir(), 'apolles-audit-'));

describe('audit log files', () => {
  it('directory is 0700 and day files are 0600', async () => {
    const dir = join(await tempDir(), 'audit-logs');
    const sink = new JsonlFileAuditSink(dir);
    await sink.init();
    await sink.record(entry());
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, '2026-11-14.jsonl'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse((await readFile(join(dir, '2026-11-14.jsonl'), 'utf8')).trim()).requestId).toBe('r');
  });

  it('tightens a day file that already exists with loose permissions', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, '2026-11-14.jsonl'), '', { mode: 0o644 });
    const sink = new JsonlFileAuditSink(dir);
    await sink.record(entry());
    expect((await stat(join(dir, '2026-11-14.jsonl'))).mode & 0o777).toBe(0o600);
  });

  it('startup fails with a clear message when the directory cannot be created', async () => {
    const base = await tempDir();
    await writeFile(join(base, 'not-a-dir'), 'x');
    await expect(new JsonlFileAuditSink(join(base, 'not-a-dir', 'audit')).init()).rejects.toThrow(/Audit log directory .* cannot be/);
  });

  it('deletes day files older than the retention, and nothing else', async () => {
    const dir = await tempDir();
    for (const name of ['2024-01-01.jsonl', '2024-11-13.jsonl', '2024-11-14.jsonl', '2026-11-13.jsonl', 'notes.txt', '2020-01-01.jsonl.bak']) {
      await writeFile(join(dir, name), 'x');
    }
    const sink = new JsonlFileAuditSink(dir, { retentionDays: 730, now: () => new Date('2026-11-14T10:00:00Z') });
    expect(await sink.sweep()).toBe(2); // 2024-11-14 is exactly 730 days old and stays; the two before it go
    expect((await readdir(dir)).sort()).toEqual(['2020-01-01.jsonl.bak', '2024-11-14.jsonl', '2026-11-13.jsonl', 'notes.txt']);
  });
});

describe('very large bodies', () => {
  it('are cut in the log, and the entry says so', async () => {
    const audit = new InMemoryAuditSink();
    const big = 'a'.repeat(50_000);
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch;
    const t = new HttpTransport({ supplierId: 's', fetchImpl, audit, auditMaxBodyBytes: 1000 });
    const res = await t.send({ operation: 'search', method: 'POST', url: 'https://supplier.example/', body: 'b'.repeat(3000), timeoutMs: 1000, idempotent: true }, { requestId: 'r' });
    expect(res.body).toHaveLength(50_000); // the caller still gets everything
    const e = audit.entries[0]!;
    expect(e.truncated).toEqual(['requestBody', 'responseBody']);
    expect(e.responseBody!.length).toBeLessThan(1200);
    expect(e.responseBody).toMatch(/truncated.*50000 bytes/);
    expect(e.requestBody).toMatch(/truncated.*3000 bytes/);
  });

  it('small bodies are logged whole (default limit is 256 KB)', async () => {
    const audit = new InMemoryAuditSink();
    const body = 'a'.repeat(200_000);
    const t = new HttpTransport({ supplierId: 's', fetchImpl: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch, audit });
    await t.send({ operation: 'search', method: 'GET', url: 'https://supplier.example/', timeoutMs: 1000, idempotent: true }, { requestId: 'r' });
    expect(audit.entries[0]!.responseBody).toHaveLength(200_000);
    expect(audit.entries[0]!.truncated).toBeUndefined();
  });
});

describe('audit write failures are never silent', () => {
  const failing: AuditSink = { record: async () => { throw new Error('ENOSPC: no space left on device'); } };

  it('are logged (rate-limited), reported as not ok, alerted, and never break the call', async () => {
    const logged: string[] = [];
    const alerts: string[] = [];
    let now = 1_000_000;
    let inner: AuditSink = failing;
    const sink = new MonitoredAuditSink({ record: (e) => inner.record(e) }, { log: (m) => logged.push(m), onFailure: (m) => alerts.push(m), now: () => now });
    expect(sink.ok).toBe(true);
    for (let i = 0; i < 5; i++) await expect(sink.record(entry())).resolves.toBeUndefined();
    expect(sink.ok).toBe(false);
    expect(logged).toHaveLength(1); // five failures in a row: one line
    expect(logged[0]).toMatch(/audit log.*ENOSPC/i);
    expect(alerts).toHaveLength(1);

    now += 11 * 60_000; // still failing later: say it again
    await sink.record(entry());
    expect(logged).toHaveLength(2);
    expect(alerts).toHaveLength(2);

    inner = new InMemoryAuditSink(); // disk is back
    await sink.record(entry());
    expect(sink.ok).toBe(true);
  });

  it('a sink without the monitor still gets an error line from the transport', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const t = new HttpTransport({ supplierId: 's', fetchImpl: (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch, audit: failing });
      const res = await t.send({ operation: 'book', method: 'POST', url: 'https://supplier.example/', body: 'x', timeoutMs: 1000, idempotent: false }, { requestId: 'r' });
      expect(res.status).toBe(200); // the booking answer is not lost because of the log
      expect(spy.mock.calls.flat().join(' ')).toMatch(/audit/i);
    } finally {
      spy.mockRestore();
    }
  });
});

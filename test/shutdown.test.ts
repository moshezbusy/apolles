import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createHttpServer } from '../src/server/http-server.js';
import { shutdownGracefully } from '../src/server/startup.js';
import { search, setup, tick } from './helpers.js';

const KEY = 'test-key-0123456789abcdefghij';

async function slowServer() {
  const s = setup({ searchDelayMs: 150 });
  const server = createHttpServer(s.service, KEY);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const slowSearch = () =>
    fetch(`${url}/v1/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify({ ...search, suppliers: ['alpha'] }) });
  return { server, url, slowSearch };
}

describe('graceful shutdown', () => {
  it('stops accepting, lets the request in flight finish, then flushes the store', async () => {
    const { server, url, slowSearch } = await slowServer();
    const order: string[] = [];
    const inFlight = slowSearch().then(async (r) => { order.push(`answered ${r.status}`); return r; });
    await tick();
    const done = shutdownGracefully({ server, flush: async () => { order.push('flushed'); }, stop: () => order.push('timers stopped'), timeoutMs: 5000, log: () => undefined });
    await tick();
    await expect(fetch(`${url}/health`)).rejects.toThrow(); // no new connections
    expect(await done).toBe('clean');
    expect((await inFlight).status).toBe(200);
    expect(order).toEqual(['answered 200', 'timers stopped', 'flushed']);
  });

  it('does not wait for ever: after the limit it cuts connections, and still flushes', async () => {
    const { server, slowSearch } = await slowServer();
    let flushed = false;
    const inFlight = slowSearch().then(() => 'answered', () => 'cut');
    await tick();
    const how = await shutdownGracefully({ server, flush: async () => { flushed = true; }, timeoutMs: 20, log: () => undefined });
    expect(how).toBe('forced');
    expect(flushed).toBe(true);
    expect(await inFlight).toBe('cut');
  });
});

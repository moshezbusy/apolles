import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHttpServer } from '../src/server/http-server.js';
import { search, setup } from './helpers.js';

const KEY = 'test-key-0123456789abcdefghij';
let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpServer(setup().service, KEY);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown, key = KEY) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) });

describe('http api', () => {
  it('requires the api key', async () => {
    expect((await post('/v1/search', search, 'wrong')).status).toBe(401);
  });
  it('search -> quote -> book -> get -> cancel', async () => {
    const s = await (await post('/v1/search', search)).json();
    expect(s.offers.length).toBeGreaterThan(0);
    const q = await (await post('/v1/quotes', { offerId: s.offers[0].offerId })).json();
    const b = await post('/v1/bookings', {
      clientReference: 'HTTP-0001', quoteId: q.quoteId, approvedTotal: q.offer.total,
      holder: { firstName: 'Dana', lastName: 'Levi' },
      guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }, { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' }]],
      payment: { type: 'AGENCY_CREDIT' },
    });
    expect(b.status).toBe(201);
    expect((await b.json()).status).toBe('CONFIRMED');
    const g = await fetch(`${base}/v1/bookings/HTTP-0001`, { headers: { 'x-api-key': KEY } });
    expect((await g.json()).status).toBe('CONFIRMED');
    expect((await (await post('/v1/bookings/HTTP-0001/cancel', {})).json()).status).toBe('CANCELLED');
  });
  it('bad input -> 400 with a clear message', async () => {
    const r = await post('/v1/search', { ...search, currency: 'usd' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('INVALID_REQUEST');
  });
});

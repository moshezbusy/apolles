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
    expect(await b.json()).toMatchObject({ status: 'CONFIRMED', booked: true, environment: 'test' });
    expect(q.environment).toBe('test');
    expect(s.offers[0].environment).toBe('test');
    // the same reference with another quote: 409, not a second booking
    const q2 = await (await post('/v1/quotes', { offerId: s.offers[0].offerId })).json();
    const replay = await post('/v1/bookings', {
      clientReference: 'HTTP-0001', quoteId: q2.quoteId, approvedTotal: q2.offer.total,
      holder: { firstName: 'Dana', lastName: 'Levi' },
      guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }, { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' }]],
      payment: { type: 'AGENCY_CREDIT' },
    });
    expect(replay.status).toBe(409);
    expect((await replay.json()).error).toBe('REFERENCE_REUSED');
    const g = await fetch(`${base}/v1/bookings/HTTP-0001`, { headers: { 'x-api-key': KEY } });
    expect((await g.json()).status).toBe('CONFIRMED');
    expect((await (await post('/v1/bookings/HTTP-0001/cancel', {})).json()).status).toBe('CANCELLED');
  });
  it('broken input is always 400, never 500', async () => {
    const raw = (path: string, body: string) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body });
    expect((await raw('/v1/search', 'null')).status).toBe(400);
    expect((await raw('/v1/quotes', 'null')).status).toBe(400);
    expect((await raw('/v1/bookings', 'null')).status).toBe(400);
    expect((await raw('/v1/bookings', '[]')).status).toBe(400);
    expect((await post('/v1/search', { ...search, suppliers: 5 })).status).toBe(400);
    const s = await (await post('/v1/search', search)).json();
    const q = await (await post('/v1/quotes', { offerId: s.offers[0].offerId })).json();
    const b = await post('/v1/bookings', {
      clientReference: 'HTTP-0002', quoteId: q.quoteId, approvedTotal: q.offer.total,
      holder: { firstName: 'Dana', lastName: 'Levi' }, guests: [[null]], payment: { type: 'AGENCY_CREDIT' },
    });
    expect(b.status).toBe(400);
    // malformed %-encoding in the path
    expect((await fetch(`${base}/v1/bookings/%E0%A4%A`, { headers: { 'x-api-key': KEY } })).status).toBe(400);
    expect((await raw('/v1/bookings/%zz/cancel', '{}')).status).toBe(400);
    // a reference that cannot exist is a bad request, not a lookup
    expect((await fetch(`${base}/v1/bookings/has_underscore`, { headers: { 'x-api-key': KEY } })).status).toBe(400);
  });
  it('the reference is upper-cased at the door: lower case finds the same booking', async () => {
    const s = await (await post('/v1/search', search)).json();
    const q = await (await post('/v1/quotes', { offerId: s.offers[0].offerId })).json();
    const b = await post('/v1/bookings', {
      clientReference: 'http-lower-1', quoteId: q.quoteId, approvedTotal: q.offer.total,
      holder: { firstName: 'Dana', lastName: 'Levi' },
      guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }, { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' }]],
      payment: { type: 'AGENCY_CREDIT' },
    });
    expect((await b.json()).clientReference).toBe('HTTP-LOWER-1');
    const g = await fetch(`${base}/v1/bookings/http-lower-1`, { headers: { 'x-api-key': KEY } });
    expect(g.status).toBe(200);
    expect((await g.json()).clientReference).toBe('HTTP-LOWER-1');
  });
  it('bad input -> 400 with a clear message', async () => {
    const r = await post('/v1/search', { ...search, currency: 'usd' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('INVALID_REQUEST');
  });
  it('refuses to start with the placeholder key from .env.example, or a short one', () => {
    expect(() => createHttpServer(setup().service, 'change-me-to-a-long-random-string-48-chars')).toThrow(/placeholder/);
    expect(() => createHttpServer(setup().service, 'short')).toThrow(/24/);
  });
  it('a person settles a NEEDS_REVIEW booking over HTTP', async () => {
    const s = setup({ timeoutNotBooked: true }, { reconcileDelaysMs: [], maxReconcileAttempts: 1 });
    const srv = createHttpServer(s.service, KEY);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const call = (path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(body) });
    try {
      const found = await (await call('/v1/search', search)).json();
      const q = await (await call('/v1/quotes', { offerId: found.offers.find((o: { supplierId: string }) => o.supplierId === 'alpha').offerId })).json();
      const b = await (await call('/v1/bookings', {
        clientReference: 'HTTP-REVIEW-1', quoteId: q.quoteId, approvedTotal: q.offer.total,
        holder: { firstName: 'Dana', lastName: 'Levi' },
        guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }, { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' }]],
        payment: { type: 'AGENCY_CREDIT' },
      })).json();
      expect(b).toMatchObject({ status: 'UNKNOWN', booked: false });
      const rec = await (await call('/v1/reconcile', {})).json();
      expect(rec.bookings[0]).toMatchObject({ status: 'NEEDS_REVIEW', booked: false });
      expect((await call('/v1/bookings/HTTP-REVIEW-1/resolve', { status: 'MAYBE', note: 'x' })).status).toBe(400);
      expect((await call('/v1/bookings/HTTP-REVIEW-1/resolve', null)).status).toBe(400);
      const done = await call('/v1/bookings/HTTP-REVIEW-1/resolve', { status: 'FAILED', note: 'Supplier confirmed by phone: no booking' });
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ status: 'FAILED', booked: false });
      expect((await call('/v1/bookings/HTTP-REVIEW-1/resolve', { status: 'FAILED', note: 'again' })).status).toBe(409);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
  it('/health reports the audit log and the bookings file', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    let auditOk = true;
    const srv = createHttpServer(setup().service, KEY, { health: () => ({ auditOk, storeOk: true }) });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/health`;
    try {
      expect(await (await fetch(url)).json()).toEqual({ ok: true, auditOk: true, storeOk: true });
      auditOk = false;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, auditOk: false, storeOk: true });
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { HotelbedsAdapter, groupRooms, hbMoney, signature } from '../src/adapters/hotelbeds/hotelbeds-adapter.js';
import { HttpTransport } from '../src/http/transport.js';
import { InMemoryAuditSink } from '../src/audit/audit.js';
import { SupplierError } from '../src/core/errors.js';
import { StaticSecretProvider } from '../src/security/secrets.js';

// Shapes follow the Hotelbeds APItude Booking API (hotel-api 1.0) documentation.
const RATE_RO = {
  rateKey: '20270301|20270304|W|1|1067|DBL.ST|NRF-RO|RO||1~2~0||N@1', rateClass: 'NRF', rateType: 'BOOKABLE',
  net: '300.00', paymentType: 'AT_WEB', boardCode: 'RO', boardName: 'ROOM ONLY', rooms: 1, adults: 2, children: 0,
  cancellationPolicies: [{ amount: '300.00', from: '2026-11-20T23:59:00+01:00' }],
  taxes: { allIncluded: false, taxes: [{ included: false, amount: '9.90', currency: 'EUR', type: 'TAXESANDFEES' }] },
};
const RATE_BB = {
  rateKey: '20270301|20270304|W|1|1067|DBL.ST|BAR-BB|BB||1~2~0||N@2', rateClass: 'NOR', rateType: 'RECHECK',
  net: '360.50', paymentType: 'AT_WEB', boardCode: 'BB', boardName: 'BED AND BREAKFAST', rooms: 1, adults: 2, children: 0,
  cancellationPolicies: [{ amount: '120.17', from: '2027-02-25T23:59:00+01:00' }],
};
const AVAIL_RS = {
  auditData: {},
  hotels: {
    hotels: [{ code: 1067, name: 'Demo Palma', currency: 'EUR', rooms: [{ code: 'DBL.ST', name: 'DOUBLE STANDARD', rates: [RATE_RO, RATE_BB] }] }],
    total: 1,
  },
};

const NOW = new Date('2026-11-17T10:00:00Z');

function make(responses: { status?: number; body: unknown }[], opts: { multiRoom?: boolean } = {}) {
  const dropped: string[] = [];
  const sent: { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const audit = new InMemoryAuditSink();
  const adapter = new HotelbedsAdapter({
    id: 'hotelbeds', baseUrl: 'https://api.test.hotelbeds.com/hotel-api/1.0', environment: 'test', certified: false,
    transport: new HttpTransport({ supplierId: 'hotelbeds', fetchImpl, audit, baseDelayMs: 1, maxAttempts: 1 }),
    secretNames: { apiKey: 'K', secret: 'S' }, secrets: new StaticSecretProvider({ K: 'key123', S: 'sec456' }), now: () => NOW,
    allowUnverifiedMultiRoom: opts.multiRoom, log: (m) => dropped.push(m),
  });
  return { adapter, sent, audit, dropped };
}

const search = {
  checkIn: '2027-03-01', checkOut: '2027-03-04', currency: 'EUR', nationality: 'IL',
  rooms: [{ adults: 2, childrenAges: [] }], supplierHotelCodes: ['1067', '1070'],
};

describe('Hotelbeds adapter', () => {
  it('signs requests: sha256(apiKey + secret + unix seconds)', async () => {
    const { adapter, sent } = make([{ body: AVAIL_RS }]);
    await adapter.search(search, { requestId: 'r' });
    const ts = Math.floor(NOW.getTime() / 1000);
    expect(sent[0]!.headers['api-key']).toBe('key123');
    expect(sent[0]!.headers['x-signature']).toBe(createHash('sha256').update(`key123sec456${ts}`).digest('hex'));
    expect(signature('a', 'b', 1)).toBe(createHash('sha256').update('ab1').digest('hex'));
  });

  it('never writes the key or signature to the audit log', async () => {
    // Real Hotelbeds answers echo the API key in auditData.internal.
    const { adapter, audit } = make([{ body: { ...AVAIL_RS, auditData: { internal: '0|D130ACF|IL|01|key123||||' } } }]);
    await adapter.search(search, { requestId: 'r' });
    const logged = JSON.stringify(audit.entries);
    expect(logged).not.toContain('key123');
    expect(logged).not.toContain('sec456');
    expect(audit.entries[0]!.requestHeaders).toMatchObject({ 'api-key': '***', 'x-signature': '***' });
  });

  it('sends an availability request and maps rates to offers', async () => {
    const { adapter, sent } = make([{ body: AVAIL_RS }]);
    const offers = await adapter.search(search, { requestId: 'r' });
    expect(sent[0]!.url).toBe('https://api.test.hotelbeds.com/hotel-api/1.0/hotels');
    expect(sent[0]!.body).toEqual({
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-04' },
      occupancies: [{ rooms: 1, adults: 2, children: 0 }],
      hotels: { hotel: [1067, 1070] },
      sourceMarket: 'IL',
    });
    expect(offers).toHaveLength(2);
    const [ro, bb] = offers;
    expect(ro!.total).toEqual({ minor: 30000, currency: 'EUR' });
    expect(ro!.board).toBe('RO');
    expect(ro!.cancellation.refundable).toBe(false);
    expect(ro!.cancellation.penalties).toEqual([{ from: '2026-11-20T22:59:00.000Z', amount: { minor: 30000, currency: 'EUR' } }]);
    expect(ro!.payAtHotel).toEqual([{ minor: 990, currency: 'EUR' }]);
    expect(ro!.rooms).toEqual([{ occupancyIndex: 0, supplierRoomCode: 'DBL.ST', roomName: 'DOUBLE STANDARD' }]);
    expect(JSON.parse(ro!.supplierData['lines']!)).toEqual([{ rateKey: RATE_RO.rateKey, rateType: 'BOOKABLE', indexes: [0] }]);
    expect(bb!.board).toBe('BB');
    expect(bb!.cancellation.refundable).toBe(true);
  });

  it('more than one room is refused until the occupancy format is verified live', async () => {
    const { adapter, sent } = make([{ body: AVAIL_RS }]);
    expect(adapter.capabilities.multiRoom).toBe(false);
    const two = [{ adults: 2, childrenAges: [] }, { adults: 2, childrenAges: [] }];
    const err = (await adapter.search({ ...search, rooms: two }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toMatch(/one room/i);
    const bookErr = (await adapter.book({ ...bookReq, offer: { ...(offer as object), occupancy: two } as never, guests: [bookReq.guests[0]!, bookReq.guests[0]!] }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(bookErr.code).toBe('VALIDATION');
    expect(sent).toHaveLength(0); // nothing reached Hotelbeds
  });

  it('one unreadable amount or date drops that one offer, with a logged reason, not the whole search', async () => {
    const rates = [
      RATE_RO,
      { ...RATE_BB, rateKey: 'BAD-NET', net: 'abc' },
      { ...RATE_BB, rateKey: 'NEGATIVE', net: '-360.50' },
      { ...RATE_BB, rateKey: 'EXPONENT', net: '3.6e2' },
      { ...RATE_BB, rateKey: 'BAD-DATE', cancellationPolicies: [{ amount: '120.17', from: 'next tuesday' }] },
      { ...RATE_BB, rateKey: 'BAD-FEE', cancellationPolicies: [{ amount: 'lots', from: '2027-02-25T23:59:00+01:00' }] },
      RATE_BB,
    ];
    const { adapter, dropped } = make([{ body: { hotels: { hotels: [{ code: 1067, currency: 'EUR', rooms: [{ code: 'DBL.ST', name: 'DOUBLE STANDARD', rates }] }] } } }]);
    const offers = await adapter.search(search, { requestId: 'r' });
    expect(offers.map((o) => o.ratePlanCode)).toEqual([RATE_RO.rateKey, RATE_BB.rateKey]);
    expect(dropped).toHaveLength(5);
    expect(dropped.join('\n')).toMatch(/hotelbeds.*1067.*offer dropped/i);
  });

  it('a cancellation deadline without a time zone is shown at its earliest possible moment', async () => {
    const rate = { ...RATE_BB, cancellationPolicies: [{ amount: '120.17', from: '2027-02-25T23:59:00' }] };
    const { adapter } = make([{ body: { hotels: { hotels: [{ code: 1067, currency: 'EUR', rooms: [{ code: 'DBL.ST', rates: [rate] }] }] } } }]);
    const [o] = await adapter.search(search, { requestId: 'r' });
    expect(o!.cancellation.penalties[0]!.from).toBe('2027-02-24T10:00:00.000Z');
  });

  it('children go as CH paxes with ages; identical rooms are grouped', async () => {
    const { adapter, sent } = make([{ body: { hotels: { total: 0 } } }], { multiRoom: true });
    const r = await adapter.search({
      ...search, rooms: [{ adults: 2, childrenAges: [7] }, { adults: 2, childrenAges: [7] }, { adults: 1, childrenAges: [] }],
    }, { requestId: 'r' });
    expect(r).toEqual([]);
    expect(sent[0]!.body!['occupancies']).toEqual([
      { rooms: 2, adults: 4, children: 2, paxes: [{ type: 'CH', age: 7 }, { type: 'CH', age: 7 }] },
      { rooms: 1, adults: 1, children: 0 },
    ]);
  });

  it('different occupancies: one combined offer per board, cheapest rate per room type', async () => {
    const single = { ...RATE_BB, rateKey: 'SGL-BB', net: '100.00', adults: 1, cancellationPolicies: [{ amount: '50.00', from: '2027-02-20T00:00:00Z' }] };
    const dbl = { ...RATE_BB, rateKey: 'DBL-BB', net: '200.00', cancellationPolicies: [{ amount: '80.00', from: '2027-02-25T00:00:00Z' }] };
    const dblRo = { ...RATE_RO, rateKey: 'DBL-RO' }; // no single RO -> no RO offer
    const { adapter } = make([{ body: { hotels: { hotels: [{ code: 1067, currency: 'EUR', rooms: [
      { code: 'SGL', name: 'Single', rates: [single] },
      { code: 'DBL', name: 'Double', rates: [dbl, dblRo] },
    ] }] } } }], { multiRoom: true });
    const offers = await adapter.search({ ...search, rooms: [{ adults: 2, childrenAges: [] }, { adults: 1, childrenAges: [] }] }, { requestId: 'r' });
    expect(offers).toHaveLength(1);
    const o = offers[0]!;
    expect(o.total).toEqual({ minor: 30000, currency: 'EUR' });
    expect(o.rooms.map((x) => x.roomName)).toEqual(['Double', 'Single']);
    expect(o.cancellation.penalties).toEqual([
      { from: '2027-02-20T00:00:00.000Z', amount: { minor: 5000, currency: 'EUR' } },
      { from: '2027-02-25T00:00:00.000Z', amount: { minor: 13000, currency: 'EUR' } },
    ]);
    expect(JSON.parse(o.supplierData['lines']!).map((l: { rateKey: string }) => l.rateKey)).toEqual(['DBL-BB', 'SGL-BB']);
  });

  it('401/403 = AUTH', async () => {
    const { adapter } = make([{ status: 401, body: { error: { code: 'AUTH', message: 'Invalid signature' } } }]);
    const err = (await adapter.search(search, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('AUTH');
  });

  it('CheckRate uses the new rateKey and the final policy and comments', async () => {
    const { adapter, sent } = make([{ body: AVAIL_RS }, {
      body: { hotel: { code: 1067, currency: 'EUR', totalNet: '362.00', rooms: [{ code: 'DBL.ST', name: 'DOUBLE STANDARD', rates: [{
        ...RATE_BB, rateKey: 'NEW-KEY', rateType: 'BOOKABLE', net: '362.00', rateComments: 'Check-in from 15:00. City tax payable at hotel.',
      }] }] } },
    }]);
    const [, bb] = await adapter.search(search, { requestId: 'r' });
    const q = await adapter.checkRate({ ...bb!, supplierData: bb!.supplierData, occupancy: search.rooms, checkIn: search.checkIn, checkOut: search.checkOut } as never, { requestId: 'r' });
    expect(sent[1]!.body).toEqual({ rooms: [{ rateKey: RATE_BB.rateKey }] });
    expect(q.available).toBe(true);
    expect(q.offer!.total).toEqual({ minor: 36200, currency: 'EUR' });
    expect(q.offer!.remarks).toContain('Check-in from 15:00. City tax payable at hotel.');
    expect(JSON.parse(q.offer!.supplierData['lines']!)[0].rateKey).toBe('NEW-KEY');
  });

  it('CheckRate: no allotment = not available', async () => {
    const { adapter } = make([{ status: 400, body: { error: { code: 'PRODUCT_ERROR', message: 'Insufficient allotment' } } }]);
    const q = await adapter.checkRate({ supplierData: { lines: JSON.stringify([{ rateKey: 'k', rateType: 'RECHECK', indexes: [0] }]) }, occupancy: search.rooms, checkIn: search.checkIn, checkOut: search.checkOut } as never, { requestId: 'r' });
    expect(q.available).toBe(false);
  });

  const offer = {
    supplierData: { lines: JSON.stringify([{ rateKey: 'K1', rateType: 'BOOKABLE', indexes: [0] }]) },
    occupancy: [{ adults: 1, childrenAges: [7] }], total: { minor: 30000, currency: 'EUR' }, paymentModel: 'PREPAID',
  } as never;
  const bookReq = {
    clientReference: 'APL-BK-7788',
    offer,
    holder: { firstName: 'Dana', lastName: 'Levi', email: 'dana@example.com' },
    guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' as const }, { firstName: 'Noa', lastName: 'Levi', type: 'CHILD' as const, age: 7 }]],
    payment: { type: 'AGENCY_CREDIT' as const },
    specialRequests: 'High floor',
  };

  it('Book sends our clientReference and paxes per room', async () => {
    const { adapter, sent } = make([{ body: { booking: {
      reference: '102-4455667', clientReference: 'APL-BK-7788', status: 'CONFIRMED', totalNet: 300, currency: 'EUR',
      hotel: { rooms: [{ status: 'CONFIRMED' }] },
    } } }]);
    const r = await adapter.book(bookReq, { requestId: 'r' });
    expect(r).toEqual({ status: 'CONFIRMED', supplierBookingRef: '102-4455667', total: { minor: 30000, currency: 'EUR' }, message: 'CONFIRMED' });
    expect(sent[0]!.body).toEqual({
      holder: { name: 'Dana', surname: 'Levi' },
      rooms: [{ rateKey: 'K1', paxes: [
        { roomId: 1, type: 'AD', name: 'Dana', surname: 'Levi' },
        { roomId: 1, type: 'CH', age: 7, name: 'Noa', surname: 'Levi' },
      ] }],
      clientReference: 'APL-BK-7788',
      tolerance: 0,
      remark: 'High floor',
    });
  });

  it('a total we cannot read does not turn a made booking into an error', async () => {
    const { adapter } = make([{ body: { booking: { reference: '102-7', status: 'CONFIRMED', totalNet: 'n/a', currency: 'EUR', hotel: { rooms: [{ status: 'CONFIRMED' }] } } } }]);
    const r = await adapter.book(bookReq, { requestId: 'r' });
    expect(r).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: '102-7' });
    expect(r.total).toBeUndefined();
  });

  it('Book: 4xx with error = definite failure; 5xx / empty = outcome unknown', async () => {
    const sold = (await make([{ status: 400, body: { error: { code: 'PRODUCT_ERROR', message: 'Insufficient allotment' } } }]).adapter.book(bookReq, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(sold.code).toBe('SOLD_OUT');
    const boom = (await make([{ status: 500, body: {} }]).adapter.book(bookReq, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(boom.code).toBe('OUTCOME_UNKNOWN');
    const empty = (await make([{ body: {} }]).adapter.book(bookReq, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(empty.code).toBe('OUTCOME_UNKNOWN');
  });

  it('Book refuses references longer than Hotelbeds allows', async () => {
    const err = (await make([{ body: {} }]).adapter.book({ ...bookReq, clientReference: 'X'.repeat(21) }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('VALIDATION');
  });

  it('finds a booking by OUR reference after a timeout', async () => {
    const { adapter, sent } = make([{ body: { bookings: { bookings: [
      { reference: '102-1', clientReference: 'OTHER', status: 'CONFIRMED' },
      { reference: '102-2', clientReference: 'APL-BK-7788', status: 'CONFIRMED', totalNet: '300.00', currency: 'EUR' },
    ] } } }]);
    const r = await adapter.getBooking({ clientReference: 'APL-BK-7788' }, { requestId: 'r' });
    const url = new URL(sent[0]!.url);
    expect(url.pathname).toBe('/hotel-api/1.0/bookings');
    expect(url.searchParams.get('clientReference')).toBe('APL-BK-7788');
    expect(url.searchParams.get('filterType')).toBe('CREATION');
    expect(r).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: '102-2' });
  });

  it('lookup by our reference is an exact match (references are upper-cased at the API door)', async () => {
    const { adapter } = make([{ body: { bookings: { bookings: [
      { reference: '102-1', clientReference: 'apl-bk-7788', status: 'CONFIRMED' },
      { reference: '102-2', clientReference: 'APL-BK-77880', status: 'CONFIRMED' },
    ] } } }]);
    expect(await adapter.getBooking({ clientReference: 'APL-BK-7788' }, { requestId: 'r' })).toBeNull();
  });

  it('a missing or unknown booking status is never read as CONFIRMED', async () => {
    const detail = async (booking: Record<string, unknown>) =>
      (await make([{ body: { booking: { reference: '102-2', ...booking } } }]).adapter.getBooking({ clientReference: 'x', supplierBookingRef: '102-2' }, { requestId: 'r' }))!.status;
    expect(await detail({ status: 'CONFIRMED' })).toBe('CONFIRMED');
    expect(await detail({})).toBe('PENDING');
    expect(await detail({ status: 'SOMETHING_NEW' })).toBe('PENDING');
    expect(await detail({ status: 'PRECONFIRMED' })).toBe('ON_REQUEST');
    expect(await detail({ status: 'CONFIRMED', hotel: { rooms: [{ status: 'ON_REQUEST' }] } })).toBe('ON_REQUEST');
    // same on the answer to book: a reference without a status is not a confirmation
    const booked = await make([{ body: { booking: { reference: '102-9' } } }]).adapter.book(bookReq, { requestId: 'r' });
    expect(booked).toMatchObject({ status: 'PENDING', supplierBookingRef: '102-9' });
  });

  it('booking detail by Hotelbeds reference; 404 = not found', async () => {
    const found = await make([{ body: { booking: { reference: '102-2', status: 'CANCELLED' } } }]).adapter.getBooking({ clientReference: 'x', supplierBookingRef: '102-2' }, { requestId: 'r' });
    expect(found).toMatchObject({ status: 'CANCELLED' });
    const missing = await make([{ status: 404, body: { error: { message: 'not found' } } }]).adapter.getBooking({ clientReference: 'x', supplierBookingRef: '102-9' }, { requestId: 'r' });
    expect(missing).toBeNull();
  });

  it('Cancel', async () => {
    const { adapter, sent } = make([{ body: { booking: { reference: '102-2', cancellationReference: 'C-1', status: 'CANCELLED', currency: 'EUR', hotel: { cancellationAmount: '0.00' } } } }]);
    const r = await adapter.cancel({ clientReference: 'x', supplierBookingRef: '102-2' }, { requestId: 'r' });
    expect(sent[0]!.method).toBe('DELETE');
    expect(sent[0]!.url).toBe('https://api.test.hotelbeds.com/hotel-api/1.0/bookings/102-2?cancellationFlag=CANCELLATION');
    expect(r).toMatchObject({ cancelled: true, cancellationRef: 'C-1', fee: { minor: 0, currency: 'EUR' } });
  });

  it('production is blocked until certified', () => {
    expect(() => new HotelbedsAdapter({
      id: 'hotelbeds', baseUrl: 'https://api.hotelbeds.com/hotel-api/1.0', environment: 'production', certified: false,
      transport: new HttpTransport({ supplierId: 'hotelbeds' }), secretNames: { apiKey: 'K', secret: 'S' }, secrets: new StaticSecretProvider({}),
    })).toThrow(/certification/);
  });

  it('helpers', () => {
    expect(hbMoney('412.50', 'EUR')).toEqual({ minor: 41250, currency: 'EUR' });
    expect(hbMoney(412.5, 'EUR')).toEqual({ minor: 41250, currency: 'EUR' });
    expect(hbMoney('10.555', 'EUR')).toEqual({ minor: 1056, currency: 'EUR' }); // rounded on the digits, no float
    expect(() => hbMoney('abc', 'EUR')).toThrow();
    expect(() => hbMoney('-1.00', 'EUR')).toThrow();
    expect(() => hbMoney('1e3', 'EUR')).toThrow();
    expect(() => hbMoney(Number.NaN, 'EUR')).toThrow();
    expect(groupRooms([{ adults: 2, childrenAges: [9, 4] }, { adults: 2, childrenAges: [4, 9] }]).map((g) => g.indexes)).toEqual([[0, 1]]);
  });
});

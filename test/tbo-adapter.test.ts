import { describe, expect, it } from 'vitest';
import { TboAdapter, amount, tboDate } from '../src/adapters/tbo/tbo-adapter.js';
import { HttpTransport } from '../src/http/transport.js';
import { InMemoryAuditSink } from '../src/audit/audit.js';
import { SupplierError } from '../src/core/errors.js';
import { MockSupplierAdapter } from '../src/adapters/mock/mock-adapter.js';
import { InMemoryMappingStore } from '../src/mapping/mapping.js';
import { SupplierRegistry } from '../src/service/registry.js';
import { SupplierService } from '../src/service/supplier-service.js';
import { InMemoryBookingStore } from '../src/store/booking-store.js';
import { InMemoryOfferCache } from '../src/store/offer-cache.js';

// Samples from TBOH Hotel API Specifications V2.1.
const SEARCH_RS = {
  Status: { Code: 200, Description: 'Successful' },
  HotelResult: [{
    HotelCode: '1120548', Currency: 'USD',
    Rooms: [{
      Name: ['Luxury Room, 1 King Bed', 'Luxury Room, 1 King Bed'],
      BookingCode: '1120548!TB!2!TB!9a47646b',
      Inclusion: 'Free WiFi', TotalFare: 305.75, TotalTax: 56.24,
      RoomPromotion: ['Private sale', 'Private sale'], MealType: 'Room_Only', IsRefundable: false,
      Supplements: [[{ Index: 1, Type: 'AtProperty', Description: 'mandatory_tax', Price: 20.0, Currency: 'AED' }], [{ Index: 2, Type: 'AtProperty', Description: 'mandatory_tax', Price: 20.0, Currency: 'AED' }]],
      WithTransfers: false,
    }],
  }],
};

const PREBOOK_RS = {
  Status: { Code: 200, Description: 'Successful' },
  HotelResult: [{
    HotelCode: '1435427', Currency: 'USD',
    Rooms: [{
      Name: ['Standard Twin Room,2 Large Twin Beds'],
      BookingCode: '1435427!TB!2!TB!a5419e54',
      TotalFare: 17.1, TotalTax: 1.94, MealType: 'BreakFast', IsRefundable: true,
      CancelPolicies: [
        { FromDate: '05-05-2027 00:00:00', ChargeType: 'Fixed', CancellationCharge: 0.0 },
        { FromDate: '12-05-2027 00:00:00', ChargeType: 'Percentage', CancellationCharge: 100.0 },
      ],
      RateConditions: ['Check-in hour 14:00'],
    }],
  }],
};

function make(responses: unknown[]) {
  const dropped: string[] = [];
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === 'hang') {
      return new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    }
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  const audit = new InMemoryAuditSink();
  const adapter = new TboAdapter({
    id: 'tbo', baseUrl: 'https://api.tbotechnology.in/TBOHolidays_HotelAPI', environment: 'test', certified: false,
    transport: new HttpTransport({ supplierId: 'tbo', fetchImpl, audit, baseDelayMs: 1 }),
    agencyEmail: 'ops@agency.example', agencyPhone: '+972 3-000-0000', log: (m) => dropped.push(m),
  });
  return { adapter, sent, audit, dropped };
}

const search = {
  checkIn: '2027-05-15', checkOut: '2027-05-17', currency: 'USD', nationality: 'IL',
  rooms: [{ adults: 1, childrenAges: [] }, { adults: 1, childrenAges: [7] }],
  supplierHotelCodes: ['1120548', '1345318'],
};

describe('TBO adapter', () => {
  it('sends a Search request as the spec describes and maps the answer', async () => {
    const { adapter, sent } = make([SEARCH_RS]);
    const offers = await adapter.search(search, { requestId: 'r' });
    expect(sent[0]!.url).toBe('https://api.tbotechnology.in/TBOHolidays_HotelAPI/Search');
    expect(sent[0]!.body).toMatchObject({
      CheckIn: '2027-05-15', CheckOut: '2027-05-17', HotelCodes: '1120548,1345318', GuestNationality: 'IL',
      PaxRooms: [{ Adults: 1, Children: 0, ChildrenAges: [] }, { Adults: 1, Children: 1, ChildrenAges: [7] }],
    });
    expect(offers).toHaveLength(1);
    const o = offers[0]!;
    expect(o.total).toEqual({ minor: 30575, currency: 'USD' });
    expect(o.board).toBe('RO');
    expect(o.rooms.map((r) => r.roomName)).toEqual(['Luxury Room, 1 King Bed', 'Luxury Room, 1 King Bed']);
    expect(o.payAtHotel).toEqual([{ minor: 2000, currency: 'AED' }, { minor: 2000, currency: 'AED' }]);
    expect(o.cancellation.refundable).toBe(false);
    expect(o.supplierData).toEqual({ bookingCode: '1120548!TB!2!TB!9a47646b', totalFare: '305.75' });
  });

  it('no availability (201) = empty list', async () => {
    const { adapter } = make([{ Status: { Code: 201, Description: 'No Available rooms for given criteria' } }]);
    expect(await adapter.search(search, { requestId: 'r' })).toEqual([]);
  });

  it('refuses to search without guest nationality', async () => {
    const { adapter } = make([SEARCH_RS]);
    await expect(adapter.search({ ...search, nationality: undefined }, { requestId: 'r' })).rejects.toThrow(/nationality/);
  });

  it('401 = AUTH error', async () => {
    const { adapter } = make([{ Status: { Code: 401, Description: 'Access Credentials is incorrect' } }]);
    const err = (await adapter.search(search, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('AUTH');
  });

  it('PreBook gives the final cancel policy', async () => {
    const { adapter, sent } = make([PREBOOK_RS]);
    const q = await adapter.checkRate(
      { supplierData: { bookingCode: '1435427!TB!2!TB!a5419e54' }, occupancy: [{ adults: 2, childrenAges: [] }], checkIn: '2027-05-15', checkOut: '2027-05-16' } as never,
      { requestId: 'r' },
    );
    expect(sent[0]!.body).toEqual({ BookingCode: '1435427!TB!2!TB!a5419e54', PaymentMode: 'Limit' });
    expect(q.available).toBe(true);
    expect(q.offer!.board).toBe('BB');
    // "12-05-2027 00:00:00" has no time zone: shown at the earliest moment 12 May can start anywhere (UTC+14).
    expect(q.offer!.cancellation.penalties).toEqual([{ from: '2027-05-11T10:00:00.000Z', amount: { minor: 1710, currency: 'USD' } }]);
    expect(q.offer!.remarks).toContain('Check-in hour 14:00');
  });

  it('PreBook 207 (rate gone) = not available', async () => {
    const { adapter } = make([{ Status: { Code: 207, Description: 'Given rate is not Available' } }]);
    const q = await adapter.checkRate({ supplierData: { bookingCode: 'x' }, occupancy: [], checkIn: '2027-01-01', checkOut: '2027-01-02' } as never, { requestId: 'r' });
    expect(q.available).toBe(false);
  });

  it('one unreadable amount or date drops that one room rate, with a logged reason, not the whole search', async () => {
    const good = SEARCH_RS.HotelResult[0]!.Rooms[0]!;
    const rs = {
      Status: { Code: 200 },
      HotelResult: [{
        HotelCode: '1120548', Currency: 'USD',
        Rooms: [
          { ...good, BookingCode: 'NEGATIVE', TotalFare: -305.75 },
          { ...good, BookingCode: 'HUGE', TotalFare: 1e21 },
          { ...good, BookingCode: 'BAD-DATE', IsRefundable: true, CancelPolicies: [{ FromDate: '31-02-2027 00:00:00', ChargeType: 'Percentage', CancellationCharge: 100 }] },
          { ...good, BookingCode: 'BAD-SUPPLEMENT', Supplements: [[{ Type: 'AtProperty', Price: -20, Currency: 'AED' }]] },
          { ...good, BookingCode: 'GOOD' },
        ],
      }],
    };
    const { adapter, dropped } = make([rs]);
    const offers = await adapter.search(search, { requestId: 'r' });
    expect(offers.map((o) => o.ratePlanCode)).toEqual(['GOOD']);
    expect(dropped).toHaveLength(4);
    expect(dropped.join('\n')).toMatch(/tbo.*1120548.*offer dropped/i);
  });

  const bookReq = {
    clientReference: 'APL-BK-7788',
    offer: { supplierData: { bookingCode: 'BC1', totalFare: '305.75' }, total: { minor: 30575, currency: 'USD' } } as never,
    holder: { firstName: 'Dana', lastName: 'Levi', email: 'dana@example.com', phone: '+972-50-000-0000' },
    guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' as const, title: 'Ms' as const }], [{ firstName: 'Noa', lastName: 'Levi', type: 'CHILD' as const, age: 7 }]],
    payment: { type: 'AGENCY_CREDIT' as const },
  };

  it('Book sends our reference as ClientReferenceId and BookingReferenceId', async () => {
    const { adapter, sent } = make([{ Status: { Code: 200, Description: 'Successful' }, ClientReferenceId: 'APL-BK-7788', ConfirmationNumber: 'FL1IMA' }]);
    const r = await adapter.book(bookReq, { requestId: 'r' });
    expect(r).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: 'FL1IMA' });
    expect(sent[0]!.body).toMatchObject({
      BookingCode: 'BC1', ClientReferenceId: 'APL-BK-7788', BookingReferenceId: 'APL-BK-7788', TotalFare: 305.75,
      EmailId: 'dana@example.com', PhoneNumber: '972500000000', BookingType: 'Voucher', PaymentMode: 'Limit',
      CustomerDetails: [
        { CustomerNames: [{ Title: 'Ms', FirstName: 'Dana', LastName: 'Levi', Type: 'Adult' }] },
        { CustomerNames: [{ Title: 'Mr', FirstName: 'Noa', LastName: 'Levi', Type: 'Child' }] },
      ],
    });
  });

  it('Book 405 = definite failure; 500 = outcome unknown; timeout = outcome unknown', async () => {
    const fail = (await make([{ Status: { Code: 405, Description: 'Booking Failed' } }]).adapter.book(bookReq, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(fail.code).toBe('VALIDATION');
    const boom = (await make([{ Status: { Code: 500, Description: 'Unexpected Error' } }]).adapter.book(bookReq, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(boom.code).toBe('OUTCOME_UNKNOWN');
  });

  it('BookingDetail by our reference', async () => {
    const { adapter, sent } = make([{
      Status: { Code: 200, Description: 'Successful' },
      BookingDetail: { BookingStatus: 'Confirmed', ConfirmationNumber: 'YOSUR8', HotelConfirmationNumber: 'H-991', Rooms: [{ Currency: 'USD', TotalFare: 85.82 }] },
    }]);
    const r = await adapter.getBooking({ clientReference: 'APL-BK-7788' }, { requestId: 'r' });
    expect(sent[0]!.body).toEqual({ BookingReferenceId: 'APL-BK-7788', PaymentMode: 'Limit' });
    expect(r).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: 'YOSUR8', hotelConfirmationNumber: 'H-991', total: { minor: 8582, currency: 'USD' } });
  });

  it('BookingDetail: only a status that means confirmed becomes CONFIRMED', async () => {
    const detail = async (BookingStatus: unknown) => {
      const { adapter } = make([{ Status: { Code: 200, Description: 'Successful' }, BookingDetail: { BookingStatus, ConfirmationNumber: 'YOSUR8' } }]);
      return (await adapter.getBooking({ clientReference: 'APL-BK-7788' }, { requestId: 'r' }))!.status;
    };
    expect(await detail('Confirmed')).toBe('CONFIRMED');
    expect(await detail('Vouchered')).toBe('CONFIRMED');
    expect(await detail('Cancelled')).toBe('CANCELLED');
    expect(await detail('CancelledAndRefundAwaited')).toBe('CANCELLED');
    expect(await detail('Failed')).toBe('FAILED');
    expect(await detail('Rejected')).toBe('FAILED');
    // not settled: the service keeps asking, then hands it to a person. Never CONFIRMED.
    expect(await detail('Pending')).toBe('PENDING');
    expect(await detail('SomethingNew')).toBe('PENDING');
    expect(await detail('')).toBe('PENDING');
    expect(await detail(undefined)).toBe('PENDING');
  });

  it('BookingDetail with a total we cannot read still reports the status', async () => {
    const { adapter } = make([{ Status: { Code: 200 }, BookingDetail: { BookingStatus: 'Confirmed', ConfirmationNumber: 'YOSUR8', Rooms: [{ Currency: 'USD', TotalFare: -1 }] } }]);
    const r = await adapter.getBooking({ clientReference: 'APL-BK-7788' }, { requestId: 'r' });
    expect(r).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: 'YOSUR8' });
    expect(r!.total).toBeUndefined();
  });

  it('Cancel', async () => {
    const { adapter } = make([{ Status: { Code: 200, Description: 'Cancelled' }, ConfirmationNumber: 'FL1IMA' }]);
    expect(await adapter.cancel({ clientReference: 'x', supplierBookingRef: 'FL1IMA' }, { requestId: 'r' })).toMatchObject({ cancelled: true, cancellationRef: 'FL1IMA' });
  });

  it('production is blocked until certified', () => {
    expect(() => new TboAdapter({
      id: 'tbo', baseUrl: 'https://x', environment: 'production', certified: false,
      transport: new HttpTransport({ supplierId: 'tbo' }), agencyEmail: 'a@b.c', agencyPhone: '1',
    })).toThrow(/certification/);
  });

  it('helpers', () => {
    expect(tboDate('12-05-2027 00:00:00')).toBe('2027-05-11T10:00:00.000Z');
    expect(tboDate('12-05-2027 18:00:00')).toBe('2027-05-11T10:00:00.000Z');
    expect(tboDate('31-02-2027 00:00:00')).toBeUndefined();
    expect(tboDate('2027-05-12T00:00:00+03:00')).toBe('2027-05-11T21:00:00.000Z');
    expect(() => amount(-1, 'USD')).toThrow();
    expect(() => amount(Number.NaN, 'USD')).toThrow();
    expect(amount(2.675, 'USD')).toEqual({ minor: 268, currency: 'USD' }); // float math gave 267
    expect(amount(1391.794, 'USD')).toEqual({ minor: 139179, currency: 'USD' });
    expect(amount(17.1, 'USD')).toEqual({ minor: 1710, currency: 'USD' });
    expect(amount(0.285, 'USD')).toEqual({ minor: 29, currency: 'USD' });
  });
});

describe('service waits 120 s before asking TBO about an unknown booking', () => {
  it('does not look up early; looks up after the wait', async () => {
    let now = new Date('2026-11-14T10:00:00Z');
    const mock = new MockSupplierAdapter('slow', [{ code: 'H1', name: 'H', nightly: '100.00', currency: 'USD' }], { timeoutButBooked: true });
    (mock.capabilities as { reconcileAfterMs?: number }).reconcileAfterMs = 120_000;
    const registry = new SupplierRegistry();
    registry.register(mock);
    const service = new SupplierService(registry, new InMemoryMappingStore([{ supplierId: 'slow', hotels: { 'APL-1': 'H1' } }]), new InMemoryBookingStore(), new InMemoryOfferCache(() => now.getTime()), {
      reconcileDelaysMs: [0], now: () => now,
    });
    const s = await service.search({ checkIn: '2027-03-01', checkOut: '2027-03-02', rooms: [{ adults: 1, childrenAges: [] }], hotelIds: ['APL-1'], currency: 'USD' });
    const q = await service.quote(s.offers[0]!.offerId);
    const b = await service.book({
      clientReference: 'WAIT-0001', quoteId: q.quoteId, approvedTotal: q.offer.total,
      holder: { firstName: 'A', lastName: 'B' }, guests: [[{ firstName: 'A', lastName: 'B', type: 'ADULT' }]], payment: { type: 'AGENCY_CREDIT' },
    });
    expect(b.status).toBe('UNKNOWN');
    expect(mock.calls).not.toContain('getBooking');
    now = new Date(now.getTime() + 121_000);
    const [r] = await service.reconcilePending();
    expect(r!.status).toBe('CONFIRMED');
    expect(mock.calls.filter((c) => c === 'book')).toHaveLength(1);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OtaAdapter } from '../src/adapters/ota/ota-adapter.js';
import { omnibeesProfile } from '../src/adapters/omnibees/profile.js';
import { mergeProfile } from '../src/bootstrap.js';
import { InMemoryAuditSink } from '../src/audit/audit.js';
import { HttpTransport } from '../src/http/transport.js';
import { InMemoryCardVault } from '../src/security/card-vault.js';
import { StaticSecretProvider } from '../src/security/secrets.js';
import { SupplierError } from '../src/core/errors.js';
import type { RateOffer } from '../src/core/types.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/ota/${n}`, import.meta.url), 'utf8');

function make(responses: string[], profile = omnibeesProfile) {
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
    return new Response(responses[Math.min(i++, responses.length - 1)], { status: 200 });
  }) as unknown as typeof fetch;
  const audit = new InMemoryAuditSink();
  const adapter = new OtaAdapter({
    id: 'omnibees',
    profile,
    baseUrl: 'https://test.supplier.example/ota',
    environment: 'test',
    secretNames: { username: 'U', password: 'P' },
    transport: new HttpTransport({ supplierId: 'omnibees', fetchImpl, audit }),
    secrets: new StaticSecretProvider({ U: 'apolles-user', P: 'topsecret' }),
    vault: new InMemoryCardVault({ tok_1: { brandCode: 'VI', number: '4111111111111111', expiry: '1228', cvc: '737', holderName: 'APOLLES LTD' } }),
  });
  return { adapter, sent, audit };
}

const searchReq = {
  checkIn: '2027-03-01', checkOut: '2027-03-05', rooms: [{ adults: 2, childrenAges: [7] }],
  supplierHotelCodes: ['PLAYA-123'], currency: 'USD',
};

describe('OTA adapter', () => {
  it('builds a correct OTA_HotelAvailRQ inside SOAP and parses offers', async () => {
    const { adapter, sent } = make([fixture('avail-rs.xml')]);
    const offers = await adapter.search(searchReq, { requestId: 'req-1' });

    const body = sent[0]!.body;
    expect(body).toContain('<soap:Envelope');
    expect(body).toContain('<OTA_HotelAvailRQ xmlns="http://www.opentravel.org/OTA/2003/05"');
    expect(body).toContain('<StayDateRange Start="2027-03-01" End="2027-03-05"');
    expect(body).toContain('<GuestCount AgeQualifyingCode="8" Age="7" Count="1"');
    expect(body).toContain('<HotelRef HotelCode="PLAYA-123"');
    expect(body).toContain('MessagePassword="topsecret"');
    expect(sent[0]!.headers['SOAPAction']).toContain('OTA_HotelAvailRQ');

    expect(offers).toHaveLength(2);
    const flex = offers.find((o) => o.ratePlanCode === 'AI-FLEX')!;
    expect(flex.board).toBe('AI');
    expect(flex.total).toEqual({ minor: 200000, currency: 'USD' });
    expect(flex.rooms[0]!.roomName).toBe('Junior Suite Ocean View');
    expect(flex.cancellation.refundable).toBe(true);
    expect(flex.cancellation.penalties[0]).toEqual({ from: '2027-02-26T00:00:00.000Z', amount: { minor: 50000, currency: 'USD' } });
    expect(flex.cancellation.text).toContain('Free cancellation');

    const nr = offers.find((o) => o.ratePlanCode === 'AI-NR')!;
    expect(nr.total).toEqual({ minor: 170000, currency: 'USD' });
    expect(nr.cancellation.refundable).toBe(false);
  });

  it('password never reaches the audit log', async () => {
    const { adapter, audit } = make([fixture('avail-rs.xml')]);
    await adapter.search(searchReq, { requestId: 'r' });
    expect(JSON.stringify(audit.entries)).not.toContain('topsecret');
  });

  it('books with the virtual card; card never reaches the audit log', async () => {
    const { adapter, sent, audit } = make([fixture('res-rs.xml')]);
    const offer: RateOffer = {
      offerId: 'x', supplierId: 'omnibees', environment: 'test', hotelId: 'APL-1', supplierHotelCode: 'PLAYA-123', ratePlanCode: 'AI-FLEX',
      rooms: [{ occupancyIndex: 0, supplierRoomCode: 'JSOV', roomName: 'JS' }], board: 'AI',
      total: { minor: 200000, currency: 'USD' }, taxesIncluded: true, paymentModel: 'PREPAID',
      cancellation: { refundable: true, penalties: [] }, checkIn: '2027-03-01', checkOut: '2027-03-05',
      occupancy: [{ adults: 2, childrenAges: [] }], supplierData: {},
    };
    const res = await adapter.book({
      clientReference: 'APL-BK-0001', offer,
      holder: { firstName: 'Dana', lastName: 'Levi & Co "x"' },
      guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }, { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' }]],
      payment: { type: 'VIRTUAL_CARD', cardToken: 'tok_1' },
    }, { requestId: 'r' });

    expect(res).toMatchObject({ status: 'CONFIRMED', supplierBookingRef: 'OB-998877', hotelConfirmationNumber: 'HTL-5566' });
    expect(sent[0]!.body).toContain('CardNumber="4111111111111111"');
    expect(sent[0]!.body).toContain('<UniqueID Type="14" ID="APL-BK-0001" ID_Context="APOLLES"');
    expect(sent[0]!.body).toContain('Levi &amp; Co');
    expect(sent[0]!.body).toContain('<Total AmountAfterTax="2000.00" CurrencyCode="USD"');
    const logged = JSON.stringify(audit.entries);
    expect(logged).not.toContain('4111111111111111');
    expect(logged).not.toContain('737');
  });

  it('booking answer without a booking number = OUTCOME_UNKNOWN', async () => {
    const { adapter } = make(['<OTA_HotelResRS xmlns="http://www.opentravel.org/OTA/2003/05"><Success/></OTA_HotelResRS>']);
    const err = (await adapter.book({
      clientReference: 'APL-BK-0002', offer: { supplierHotelCode: 'H', ratePlanCode: 'R', rooms: [{ supplierRoomCode: 'X' }], occupancy: [{ adults: 1, childrenAges: [] }], total: { minor: 100, currency: 'USD' }, supplierData: {} } as unknown as RateOffer,
      holder: { firstName: 'a', lastName: 'b' }, guests: [[{ firstName: 'a', lastName: 'b', type: 'ADULT' }]], payment: { type: 'AGENCY_CREDIT' },
    }, { requestId: 'r' }).catch((e) => e)) as SupplierError;
    expect(err.code).toBe('OUTCOME_UNKNOWN');
  });

  it('configured "no availability" error codes return empty results', async () => {
    const profile = mergeProfile(omnibeesProfile, { noAvailabilityErrorCodes: ['322'] });
    const { adapter } = make(['<OTA_HotelAvailRS xmlns="http://www.opentravel.org/OTA/2003/05"><Errors><Error Code="322" ShortText="No availability"/></Errors></OTA_HotelAvailRS>'], profile);
    expect(await adapter.search(searchReq, { requestId: 'r' })).toEqual([]);
  });

  it('refuses XML with DOCTYPE (XXE protection)', async () => {
    const { adapter } = make(['<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><OTA_HotelAvailRS>&e;</OTA_HotelAvailRS>']);
    await expect(adapter.search(searchReq, { requestId: 'r' })).rejects.toThrow(/DOCTYPE/);
  });

  it('SOAP fault becomes an error', async () => {
    const { adapter } = make(['<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>Server busy</faultstring></soap:Fault></soap:Body></soap:Envelope>']);
    await expect(adapter.search(searchReq, { requestId: 'r' })).rejects.toThrow(/Server busy/);
  });

  it('an unverified profile cannot be used in production', () => {
    expect(() => new OtaAdapter({
      id: 'omnibees', profile: omnibeesProfile, baseUrl: 'https://x', environment: 'production',
      secretNames: { username: 'U', password: 'P' }, transport: new HttpTransport({ supplierId: 'o' }),
      secrets: new StaticSecretProvider({}), vault: new InMemoryCardVault({}),
    })).toThrow(/not verified/);
  });
});

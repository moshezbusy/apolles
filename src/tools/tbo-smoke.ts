/**
 * Live check against TBO staging. Writes every call (redacted) to
 * audit-logs/, which is also the log TBO asks for in certification.
 *
 *   node dist/tools/tbo-smoke.js                 search + prebook only
 *   node dist/tools/tbo-smoke.js --book          also book (staging bookings are not real) + detail + cancel
 *
 * Options: --country MX --city Cancun --nationality IL --checkin 2027-03-10 --nights 3
 * Credentials: TBO_USERNAME / TBO_PASSWORD env vars, or injected by the network proxy.
 */
import { randomUUID } from 'node:crypto';
import { TboAdapter } from '../adapters/tbo/tbo-adapter.js';
import { JsonlFileAuditSink } from '../audit/audit.js';
import { HttpTransport } from '../http/transport.js';
import { EnvSecretProvider } from '../security/secrets.js';
import { moneyToDecimal } from '../core/money.js';
import type { RateOffer } from '../core/types.js';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const BASE = process.env['TBO_BASE_URL'] ?? 'https://api.tbotechnology.in/TBOHolidays_HotelAPI';
const audit = new JsonlFileAuditSink(process.env['AUDIT_DIR'] ?? 'audit-logs');
const transport = new HttpTransport({ supplierId: 'tbo', audit, rateLimitPerSecond: 2, maxAttempts: 2 });
const secrets = new EnvSecretProvider();
const adapter = new TboAdapter({
  id: 'tbo', baseUrl: BASE, environment: 'test', certified: false, transport,
  secretNames: { username: 'TBO_USERNAME', password: 'TBO_PASSWORD' }, secrets,
  agencyEmail: process.env['TBO_AGENCY_EMAIL'] ?? 'test@example.com',
  agencyPhone: process.env['TBO_AGENCY_PHONE'] ?? '972000000000',
});
const ctx = { requestId: `smoke-${randomUUID()}` };

async function raw(method: string, body?: unknown): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secrets.has('TBO_USERNAME') && secrets.has('TBO_PASSWORD')) {
    headers['authorization'] = `Basic ${Buffer.from(`${secrets.get('TBO_USERNAME')}:${secrets.get('TBO_PASSWORD')}`).toString('base64')}`;
  }
  const res = await transport.send(
    { operation: method, method: body === undefined ? 'GET' : 'POST', url: `${BASE}/${method}`, headers, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 60_000, idempotent: true },
    ctx,
  );
  return JSON.parse(res.body) as Record<string, unknown>;
}

function step(name: string, detail: string): void {
  console.log(`\n== ${name}\n${detail}`);
}

async function main(): Promise<void> {
  const country = opt('country', 'MX');
  const cityName = opt('city', 'Cancun').toLowerCase();
  const nationality = opt('nationality', 'IL');
  const nights = Number(opt('nights', '3'));
  const checkIn = opt('checkin', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  const checkOut = new Date(Date.parse(checkIn) + nights * 86_400_000).toISOString().slice(0, 10);

  const cities = await raw('CityList', { CountryCode: country });
  const st = cities['Status'] as { Code?: number; Description?: string } | undefined;
  if (st?.Code !== 200) throw new Error(`CityList: ${st?.Code} ${st?.Description}`);
  const city = ((cities['CityList'] as { Code: string; Name: string }[]) ?? []).find((c) => c.Name.toLowerCase().includes(cityName));
  if (!city) throw new Error(`City "${cityName}" not found in ${country}`);
  step('CityList', `${city.Name} = ${city.Code}`);

  const list = await raw('TBOHotelCodeList', { CityCode: city.Code, IsDetailedResponse: 'false' });
  const hotels = ((list['Hotels'] as { HotelCode: string; HotelName: string }[]) ?? []).slice(0, 100);
  step('TBOHotelCodeList', `${hotels.length} hotels, e.g. ${hotels.slice(0, 3).map((h) => `${h.HotelName} (${h.HotelCode})`).join(', ')}`);
  if (!hotels.length) throw new Error('No hotels returned');

  const offers = await adapter.search(
    { checkIn, checkOut, rooms: [{ adults: 2, childrenAges: [] }], supplierHotelCodes: hotels.map((h) => h.HotelCode), currency: 'USD', nationality },
    ctx,
  );
  step('Search', `${offers.length} offers ${checkIn}..${checkOut}`);
  if (!offers.length) return;
  const cheapest = [...offers].sort((a, b) => a.total.minor - b.total.minor)[0]!;
  const name = hotels.find((h) => h.HotelCode === cheapest.supplierHotelCode)?.HotelName;
  step('Cheapest', `${name} | ${cheapest.rooms[0]?.roomName} | ${cheapest.board} | ${moneyToDecimal(cheapest.total)} ${cheapest.total.currency} | refundable=${cheapest.cancellation.refundable}`);

  const offer: RateOffer = {
    ...cheapest, offerId: 'smoke', supplierId: 'tbo', hotelId: cheapest.supplierHotelCode, board: cheapest.board ?? 'OTHER',
    checkIn, checkOut, occupancy: [{ adults: 2, childrenAges: [] }],
  };
  const q = await adapter.checkRate(offer, ctx);
  if (!q.available || !q.offer) return step('PreBook', 'not available any more');
  step('PreBook', `${moneyToDecimal(q.offer.total)} ${q.offer.total.currency} | penalties: ${JSON.stringify(q.offer.cancellation.penalties)}`);

  if (!args.includes('--book')) return step('Done', 'search + prebook OK. Run with --book to test a (fake) staging booking.');

  const ref = `APLTEST-${Date.now()}`;
  const booked = await adapter.book(
    {
      clientReference: ref,
      offer: { ...offer, ...q.offer, board: q.offer.board ?? 'OTHER' },
      holder: { firstName: 'Test', lastName: 'Apolles' },
      guests: [[{ firstName: 'Test', lastName: 'Apolles', type: 'ADULT' }, { firstName: 'Second', lastName: 'Apolles', type: 'ADULT' }]],
      payment: { type: 'AGENCY_CREDIT' },
    },
    ctx,
  );
  step('Book', JSON.stringify(booked));
  const detail = await adapter.getBooking({ clientReference: ref, supplierBookingRef: booked.supplierBookingRef }, ctx);
  step('BookingDetail', JSON.stringify(detail));
  const cxl = await adapter.cancel({ clientReference: ref, supplierBookingRef: booked.supplierBookingRef }, ctx);
  step('Cancel', JSON.stringify(cxl));
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

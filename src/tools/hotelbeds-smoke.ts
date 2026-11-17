/**
 * Live check against the Hotelbeds TEST environment. Writes every call
 * (redacted) to audit-logs/, which is also the evidence for certification.
 *
 *   node dist/tools/hotelbeds-smoke.js           availability + checkrate (4 calls)
 *   node dist/tools/hotelbeds-smoke.js --book    also book + lookup + cancel (test bookings are not real)
 *
 * Options: --destination PMI --nationality IL --checkin 2027-03-10 --nights 3
 * Credentials: HOTELBEDS_API_KEY / HOTELBEDS_SECRET env vars.
 * Behind an HTTPS proxy (Node 22): run with NODE_USE_ENV_PROXY=1.
 * Evaluation keys allow ~50 requests a day: run it sparingly.
 */
import { randomUUID } from 'node:crypto';
import { HotelbedsAdapter, signature } from '../adapters/hotelbeds/hotelbeds-adapter.js';
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
const BASE = process.env['HOTELBEDS_BASE_URL'] ?? 'https://api.test.hotelbeds.com/hotel-api/1.0';
const audit = new JsonlFileAuditSink(process.env['AUDIT_DIR'] ?? 'audit-logs');
const transport = new HttpTransport({ supplierId: 'hotelbeds', audit, rateLimitPerSecond: 1, maxAttempts: 1 });
const secrets = new EnvSecretProvider();
const names = { apiKey: 'HOTELBEDS_API_KEY', secret: 'HOTELBEDS_SECRET' };
const adapter = new HotelbedsAdapter({ id: 'hotelbeds', baseUrl: BASE, environment: 'test', certified: false, transport, secretNames: names, secrets });
const ctx = { requestId: `smoke-${randomUUID()}` };

function step(name: string, detail: string): void {
  console.log(`\n== ${name}\n${detail}`);
}

async function main(): Promise<void> {
  const destination = opt('destination', 'PMI');
  const nationality = opt('nationality', 'IL');
  const nights = Number(opt('nights', '3'));
  const checkIn = opt('checkin', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  const checkOut = new Date(Date.parse(checkIn) + nights * 86_400_000).toISOString().slice(0, 10);
  const rooms = [{ adults: 2, childrenAges: [] as number[] }];

  // 1. Status (does not count much, proves the key + signature work).
  const key = secrets.get(names.apiKey);
  const ts = Math.floor(Date.now() / 1000);
  const status = await transport.send({
    operation: 'status', method: 'GET', url: `${BASE}/status`, timeoutMs: 15_000, idempotent: true, sensitiveValues: [key, secrets.get(names.secret)],
    headers: { 'api-key': key, 'x-signature': signature(key, secrets.get(names.secret), ts), accept: 'application/json' },
  }, ctx);
  step('Status', `HTTP ${status.status} ${status.body.slice(0, 200)}`);
  if (status.status !== 200) throw new Error('API key / secret rejected');

  // 2. Find hotels with availability in the destination (raw call, discovery only).
  const discovery = await transport.send({
    operation: 'discover', method: 'POST', url: `${BASE}/hotels`, timeoutMs: 25_000, idempotent: true, sensitiveValues: [key, secrets.get(names.secret)],
    headers: {
      'api-key': key, 'x-signature': signature(key, secrets.get(names.secret), Math.floor(Date.now() / 1000)),
      accept: 'application/json', 'accept-encoding': 'gzip', 'content-type': 'application/json',
    },
    body: JSON.stringify({
      stay: { checkIn, checkOut }, occupancies: [{ rooms: 1, adults: 2, children: 0 }],
      destination: { code: destination }, sourceMarket: nationality,
    }),
  }, ctx);
  const disc = JSON.parse(discovery.body) as { hotels?: { hotels?: { code: number; name: string }[] }; error?: unknown };
  const found = (disc.hotels?.hotels ?? []).slice(0, 20);
  step('Discover', `HTTP ${discovery.status}, ${found.length} hotels, e.g. ${found.slice(0, 3).map((h) => `${h.name} (${h.code})`).join(', ')}`);
  if (!found.length) throw new Error(`No availability in ${destination}: ${JSON.stringify(disc.error ?? {})}`);

  // 3. Search through the adapter (same path Apolles uses).
  const offers = await adapter.search(
    { checkIn, checkOut, rooms, supplierHotelCodes: found.map((h) => String(h.code)), currency: 'EUR', nationality },
    ctx,
  );
  step('Search', `${offers.length} offers ${checkIn}..${checkOut}`);
  if (!offers.length) return;
  const refundable = offers.filter((o) => o.cancellation.refundable && o.paymentModel === 'PREPAID');
  const pick = [...(refundable.length ? refundable : offers)].sort((a, b) => a.total.minor - b.total.minor)[0]!;
  const name = found.find((h) => String(h.code) === pick.supplierHotelCode)?.name;
  step('Picked', `${name} | ${pick.rooms[0]?.roomName} | ${pick.boardRaw} | ${moneyToDecimal(pick.total)} ${pick.total.currency} | refundable=${pick.cancellation.refundable}`);

  // 4. CheckRate.
  const offer: RateOffer = {
    ...pick, offerId: 'smoke', supplierId: 'hotelbeds', hotelId: pick.supplierHotelCode, board: pick.board ?? 'OTHER',
    checkIn, checkOut, occupancy: rooms,
  };
  const q = await adapter.checkRate(offer, ctx);
  if (!q.available || !q.offer) return step('CheckRate', 'not available any more');
  step('CheckRate', `${moneyToDecimal(q.offer.total)} ${q.offer.total.currency} | penalties: ${JSON.stringify(q.offer.cancellation.penalties)}\nremarks: ${(q.offer.remarks ?? []).join(' | ').slice(0, 400)}`);

  if (!args.includes('--book')) return step('Done', 'availability + checkrate OK. Run with --book to test a (fake) test-environment booking.');

  // 5. Book, find it again by OUR reference (timeout path), cancel.
  const ref = `APLT${Date.now().toString(36).toUpperCase()}`;
  const booked = await adapter.book(
    {
      clientReference: ref,
      offer: { ...offer, ...q.offer, board: q.offer.board ?? 'OTHER' },
      holder: { firstName: 'Test', lastName: 'Apolles' },
      guests: [[{ firstName: 'Test', lastName: 'Apolles', type: 'ADULT' }, { firstName: 'Second', lastName: 'Apolles', type: 'ADULT' }]],
      payment: { type: 'AGENCY_CREDIT' },
      specialRequests: 'TEST BOOKING - please ignore',
    },
    ctx,
  );
  step('Book', JSON.stringify(booked));
  const byRef = await adapter.getBooking({ clientReference: ref }, ctx);
  step('Lookup by clientReference', JSON.stringify(byRef));
  const cxl = await adapter.cancel({ clientReference: ref, supplierBookingRef: booked.supplierBookingRef }, ctx);
  step('Cancel', JSON.stringify(cxl));
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

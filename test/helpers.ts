import { InMemoryAlertSink } from '../src/alerts/alerts.js';
import { MockSupplierAdapter, type MockScenario } from '../src/adapters/mock/mock-adapter.js';
import { InMemoryMappingStore } from '../src/mapping/mapping.js';
import { SupplierRegistry } from '../src/service/registry.js';
import { SupplierService, type ServiceOptions } from '../src/service/supplier-service.js';
import { InMemoryBookingStore } from '../src/store/booking-store.js';
import { InMemoryOfferCache } from '../src/store/offer-cache.js';
import type { BookRequest, SearchRequest } from '../src/core/types.js';

const ALPHA_HOTELS = [{ code: 'A1', name: 'Alpha Resort', nightly: '200.00', currency: 'USD' }];

export function setup(
  scenario: MockScenario = {},
  opts: Partial<ServiceOptions> = {},
  second?: MockScenario,
  /** Pass a subclass of the mock (e.g. one whose lookups can be held back) as supplier "alpha". */
  makeAlpha: (hotels: typeof ALPHA_HOTELS, scenario: MockScenario) => MockSupplierAdapter = (h, sc) => new MockSupplierAdapter('alpha', h, sc),
) {
  const a = makeAlpha(ALPHA_HOTELS, scenario);
  const b = new MockSupplierAdapter('beta', [{ code: 'B-77', name: 'Same hotel via beta', nightly: '190.00', currency: 'USD' }], second ?? {});
  const registry = new SupplierRegistry();
  registry.register(a, { searchTimeoutMs: 200 });
  registry.register(b, { searchTimeoutMs: 200 });
  const mapping = new InMemoryMappingStore([
    { supplierId: 'alpha', hotels: { 'APL-1': 'A1' } },
    { supplierId: 'beta', hotels: { 'APL-1': 'B-77' } },
  ]);
  const store = new InMemoryBookingStore();
  const alerts = new InMemoryAlertSink();
  const service = new SupplierService(registry, mapping, store, new InMemoryOfferCache(), {
    reconcileDelaysMs: [0, 0],
    maxReconcileAttempts: 3,
    now: () => new Date('2026-11-14T10:00:00Z'),
    alerts,
    log: () => undefined,
    ...opts,
  });
  return { service, a, b, store, registry, alerts, mapping };
}

export const search: SearchRequest = {
  checkIn: '2027-03-01',
  checkOut: '2027-03-05',
  rooms: [{ adults: 2, childrenAges: [] }],
  hotelIds: ['APL-1'],
  currency: 'USD',
  nationality: 'IL',
};

export function bookReq(quoteId: string, approved: { minor: number; currency: string }, ref = 'APL-BK-0001'): BookRequest {
  return {
    clientReference: ref,
    quoteId,
    approvedTotal: approved,
    holder: { firstName: 'Dana', lastName: 'Levi', email: 'dana@example.com' },
    guests: [[
      { firstName: 'Dana', lastName: 'Levi', type: 'ADULT' },
      { firstName: 'Avi', lastName: 'Levi', type: 'ADULT' },
    ]],
    payment: { type: 'AGENCY_CREDIT' },
  };
}

/** search + quote on supplier "alpha" (or another one). */
export async function quoted(s: ReturnType<typeof setup>, supplier = 'alpha') {
  const r = await s.service.search(search);
  const offer = r.offers.find((o) => o.supplierId === supplier)!;
  return s.service.quote(offer.offerId);
}

/** search + quote + book in one step. */
export async function booked(s: ReturnType<typeof setup>, ref = 'APL-BK-0001') {
  const q = await quoted(s);
  return s.service.book(bookReq(q.quoteId, q.offer.total, ref));
}

/** A promise you resolve by hand, to hold a supplier call "in flight". */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let everything that is ready to run, run. */
export const tick = () => new Promise<void>((r) => setTimeout(r, 5));

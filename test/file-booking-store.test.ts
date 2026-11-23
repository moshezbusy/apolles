import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockSupplierAdapter } from '../src/adapters/mock/mock-adapter.js';
import type { BookingRecord } from '../src/core/types.js';
import { InMemoryMappingStore } from '../src/mapping/mapping.js';
import { openBookingStore } from '../src/server/startup.js';
import { SupplierRegistry } from '../src/service/registry.js';
import { SupplierService } from '../src/service/supplier-service.js';
import { InMemoryBookingStore } from '../src/store/booking-store.js';
import { FileBookingStore } from '../src/store/file-booking-store.js';
import { InMemoryOfferCache } from '../src/store/offer-cache.js';

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'apolles-store-'));
  return join(dir, 'bookings', 'bookings.json');
}

function record(ref: string, status: BookingRecord['status'] = 'PENDING'): BookingRecord {
  const at = '2026-11-14T10:00:00.000Z';
  return {
    clientReference: ref, supplierId: 'alpha', hotelId: 'APL-1', status, environment: 'test',
    offer: {
      offerId: 'o', supplierId: 'alpha', hotelId: 'APL-1', supplierHotelCode: 'A1', ratePlanCode: 'BAR-RO', environment: 'test',
      rooms: [{ occupancyIndex: 0, supplierRoomCode: 'DBL', roomName: 'Double room' }], board: 'RO',
      total: { minor: 80000, currency: 'USD' }, taxesIncluded: true, paymentModel: 'PREPAID',
      cancellation: { refundable: true, penalties: [] }, checkIn: '2027-03-01', checkOut: '2027-03-05',
      occupancy: [{ adults: 2, childrenAges: [] }], supplierData: {},
    },
    total: { minor: 80000, currency: 'USD' },
    holder: { firstName: 'Dana', lastName: 'Levi' },
    guests: [[{ firstName: 'Dana', lastName: 'Levi', type: 'ADULT' }]],
    paymentType: 'AGENCY_CREDIT', reconcileAttempts: 0, createdAt: at, updatedAt: at,
    history: [{ at, status, note: 'sent to supplier' }],
  };
}

describe('file booking store', () => {
  it('a created record is on disk before create() returns, and survives a restart', async () => {
    const path = await tempFile();
    const store = await FileBookingStore.open(path);
    expect(await store.create(record('APL-BK-0001', 'CONFIRMED'))).toBe(true);
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { bookings: BookingRecord[] };
    expect(onDisk.bookings.map((b) => b.clientReference)).toEqual(['APL-BK-0001']);

    const again = await FileBookingStore.open(path);
    expect((await again.get('APL-BK-0001'))!.status).toBe('CONFIRMED');
    // The idempotency key survives too: the same reference cannot be created twice.
    expect(await again.create(record('APL-BK-0001'))).toBe(false);
  });

  it('create is atomic: two parallel creates of one reference, only one wins', async () => {
    const store = await FileBookingStore.open(await tempFile());
    const results = await Promise.all([store.create(record('APL-BK-0002')), store.create(record('APL-BK-0002'))]);
    expect(results.sort()).toEqual([false, true]);
  });

  it('file is 0600, its directory 0700, and no temp file is left behind', async () => {
    const path = await tempFile();
    const store = await FileBookingStore.open(path);
    await store.create(record('APL-BK-0003'));
    await store.update({ ...record('APL-BK-0003'), status: 'CONFIRMED' });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(path, '..'))).toEqual(['bookings.json']);
  });

  it('a corrupt file stops startup; it never starts empty over existing data', async () => {
    const path = await tempFile();
    await (await FileBookingStore.open(path)).create(record('APL-BK-0004'));
    await writeFile(path, '{"version":1,"bookings":[{"clientRef', 'utf8');
    await expect(FileBookingStore.open(path)).rejects.toThrow(/corrupt|cannot be read/i);
    await writeFile(path, '', 'utf8');
    await expect(FileBookingStore.open(path)).rejects.toThrow(/corrupt|cannot be read/i);
    await writeFile(path, '{"version":1,"bookings":[{"status":"CONFIRMED"}]}', 'utf8');
    await expect(FileBookingStore.open(path)).rejects.toThrow(/corrupt|cannot be read/i);
  });

  it('a PENDING record found at startup becomes UNKNOWN (the process died mid-booking)', async () => {
    const path = await tempFile();
    await (await FileBookingStore.open(path)).create(record('APL-BK-0005', 'PENDING'));
    const store = await FileBookingStore.open(path, { now: () => new Date('2026-11-14T11:00:00Z') });
    const r = (await store.get('APL-BK-0005'))!;
    expect(r.status).toBe('UNKNOWN');
    expect(r.history.at(-1)!.note).toMatch(/restart/i);
    // and that change is on disk as well
    expect((await (await FileBookingStore.open(path)).get('APL-BK-0005'))!.status).toBe('UNKNOWN');
  });

  it('listByStatus returns copies', async () => {
    const store = await FileBookingStore.open(await tempFile());
    await store.create(record('APL-BK-0006', 'UNKNOWN'));
    const [r] = await store.listByStatus(['UNKNOWN']);
    r!.status = 'CONFIRMED';
    expect((await store.get('APL-BK-0006'))!.status).toBe('UNKNOWN');
  });
});

describe('restart recovery through the service', () => {
  it('after a crash mid-booking the booking is looked up, never sent again', async () => {
    const path = await tempFile();
    const before = await FileBookingStore.open(path);
    await before.create(record('APL-BK-0007', 'PENDING')); // written, then the process died

    // New process. The supplier did receive the booking before the crash.
    const mock = new MockSupplierAdapter('alpha', [{ code: 'A1', name: 'Alpha', nightly: '200.00', currency: 'USD' }]);
    mock.bookings.set('APL-BK-0007', { ref: 'MOCK-1', status: 'CONFIRMED', offer: record('x').offer });
    const registry = new SupplierRegistry();
    registry.register(mock);
    const store = await FileBookingStore.open(path);
    const service = new SupplierService(registry, new InMemoryMappingStore([{ supplierId: 'alpha', hotels: { 'APL-1': 'A1' } }]), store, new InMemoryOfferCache(), {});
    await service.reconcilePending();
    const r = await service.getBooking('APL-BK-0007');
    expect(r.status).toBe('CONFIRMED');
    expect(r.supplierBookingRef).toBe('MOCK-1');
    expect(mock.calls).not.toContain('book');
  });
});

describe('choosing the booking store at startup', () => {
  it('production refuses to start without BOOKINGS_FILE', async () => {
    await expect(openBookingStore({ NODE_ENV: 'production' }, '/tmp')).rejects.toThrow(/BOOKINGS_FILE/);
  });
  it('uses the file store when BOOKINGS_FILE is set, memory otherwise (dev)', async () => {
    const path = await tempFile();
    expect((await openBookingStore({ NODE_ENV: 'production', BOOKINGS_FILE: path }, '/tmp')).store).toBeInstanceOf(FileBookingStore);
    expect((await openBookingStore({}, '/tmp', () => undefined)).store).toBeInstanceOf(InMemoryBookingStore);
  });
});

import { resolve } from 'node:path';
import { InMemoryBookingStore, type BookingStore } from '../store/booking-store.js';
import { FileBookingStore } from '../store/file-booking-store.js';

/**
 * Startup decisions, kept out of main.ts so they can be tested.
 */

export interface OpenedBookingStore {
  store: BookingStore;
  /** Wait until all changes are on disk (no-op for the in-memory store). */
  flush: () => Promise<void>;
  /** False after a failed write to the bookings file. */
  ok: () => boolean;
}

/**
 * BOOKINGS_FILE set: durable file store. Not set: in-memory store, allowed
 * for development and tests only. Production refuses to start without the
 * file, because a restart would forget bookings and idempotency keys.
 */
export async function openBookingStore(
  env: NodeJS.ProcessEnv,
  root: string,
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<OpenedBookingStore> {
  const file = env['BOOKINGS_FILE'];
  if (file) {
    const store = await FileBookingStore.open(resolve(root, file));
    return { store, flush: () => store.flush(), ok: () => store.ok };
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error(
      'BOOKINGS_FILE is required in production (e.g. /data/bookings/bookings.json). ' +
        'Without it a restart forgets bookings, idempotency keys and bookings waiting to be checked with the supplier.',
    );
  }
  warn('BOOKINGS_FILE is not set: bookings are kept in memory and are lost on restart (development only)');
  return { store: new InMemoryBookingStore(), flush: async () => undefined, ok: () => true };
}

import type { BookingRecord, BookingStatus } from '../core/types.js';

/**
 * Persists bookings. `create` is the idempotency guard: the same
 * clientReference can never create two bookings. Production implementation
 * goes on Postgres with a UNIQUE constraint (see db/schema.sql).
 */
export interface BookingStore {
  /** Returns false if a booking with this clientReference already exists. */
  create(record: BookingRecord): Promise<boolean>;
  get(clientReference: string): Promise<BookingRecord | undefined>;
  update(record: BookingRecord): Promise<void>;
  listByStatus(statuses: BookingStatus[]): Promise<BookingRecord[]>;
}

export class InMemoryBookingStore implements BookingStore {
  private readonly items = new Map<string, BookingRecord>();

  async create(record: BookingRecord): Promise<boolean> {
    if (this.items.has(record.clientReference)) return false;
    this.items.set(record.clientReference, structuredClone(record));
    return true;
  }

  async get(ref: string): Promise<BookingRecord | undefined> {
    const r = this.items.get(ref);
    return r ? structuredClone(r) : undefined;
  }

  async update(record: BookingRecord): Promise<void> {
    if (!this.items.has(record.clientReference)) throw new Error(`Unknown booking ${record.clientReference}`);
    this.items.set(record.clientReference, structuredClone(record));
  }

  async listByStatus(statuses: BookingStatus[]): Promise<BookingRecord[]> {
    return [...this.items.values()].filter((r) => statuses.includes(r.status)).map((r) => structuredClone(r));
  }
}

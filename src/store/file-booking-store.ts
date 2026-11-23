import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BookingRecord, BookingStatus } from '../core/types.js';
import type { BookingStore } from './booking-store.js';

const STATUSES: ReadonlySet<string> = new Set(['PENDING', 'CONFIRMED', 'ON_REQUEST', 'FAILED', 'UNKNOWN', 'NEEDS_REVIEW', 'CANCELLED']);

interface FileShape {
  version: 1;
  bookings: BookingRecord[];
}

/**
 * Bookings in one JSON file, for a single server instance. Without it a
 * restart forgets every booking, every idempotency key and every booking
 * whose outcome is still unknown.
 *
 * Every change rewrites the file atomically: write a temp file in the same
 * directory, fsync it, rename it over the old one. A crash leaves either the
 * old file or the new one, never half of one. `create` returns only after
 * the record is on disk, so the supplier is never called for a booking that
 * a crash could forget.
 *
 * More than one instance needs Postgres instead (db/schema.sql).
 */
export class FileBookingStore implements BookingStore {
  private readonly items = new Map<string, BookingRecord>();
  private running: Promise<void> = Promise.resolve();
  private queued: Promise<void> | undefined;
  private seq = 0;
  private lastWriteOk = true;

  private constructor(private readonly path: string) {}

  /** False after a failed write, true again after the next good one. Shown in /health. */
  get ok(): boolean {
    return this.lastWriteOk;
  }

  static async open(path: string, opts: { now?: () => Date } = {}): Promise<FileBookingStore> {
    const store = new FileBookingStore(path);
    const dir = dirname(path);
    try {
      // mkdir tells us whether it created the directory; only then is it ours to lock down.
      const created = await mkdir(dir, { recursive: true, mode: 0o700 });
      if (created) await chmod(dir, 0o700);
      else if (((await stat(dir)).mode & 0o077) !== 0) {
        console.warn(`Bookings file: directory ${dir} is readable by other users; use a dedicated directory with mode 0700`);
      }
    } catch (err) {
      throw new Error(`Bookings file: cannot create directory ${dir}: ${message(err)}`);
    }

    let text: string | undefined;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Bookings file ${path} exists but cannot be read (${message(err)}). Refusing to start empty over existing data.`);
      }
    }
    if (text !== undefined) {
      for (const r of parse(text, path)) store.items.set(r.clientReference, r);
    }

    // A booking still PENDING means the process died between "saved" and
    // "supplier answered". We cannot know whether the supplier got it, so it
    // is UNKNOWN: reconcile asks the supplier. It is never sent again.
    const at = (opts.now?.() ?? new Date()).toISOString();
    for (const r of store.items.values()) {
      if (r.status !== 'PENDING') continue;
      r.status = 'UNKNOWN';
      r.updatedAt = at;
      r.history.push({ at, status: 'UNKNOWN', note: 'service restarted while the booking was being sent; outcome unknown' });
    }

    await store.removeStaleTempFiles();
    // Also proves at startup that the file can be written.
    try {
      await store.persist();
    } catch (err) {
      throw new Error(`Bookings file ${path} cannot be written: ${message(err)}`);
    }
    return store;
  }

  async create(record: BookingRecord): Promise<boolean> {
    // Check and insert happen in one synchronous step, so two parallel
    // requests with the same reference can never both win.
    if (this.items.has(record.clientReference)) return false;
    this.items.set(record.clientReference, structuredClone(record));
    try {
      await this.persist();
    } catch (err) {
      this.items.delete(record.clientReference); // not on disk = not created
      throw err;
    }
    return true;
  }

  async get(ref: string): Promise<BookingRecord | undefined> {
    const r = this.items.get(ref);
    return r ? structuredClone(r) : undefined;
  }

  async update(record: BookingRecord): Promise<void> {
    if (!this.items.has(record.clientReference)) throw new Error(`Unknown booking ${record.clientReference}`);
    this.items.set(record.clientReference, structuredClone(record));
    await this.persist();
  }

  async listByStatus(statuses: BookingStatus[]): Promise<BookingRecord[]> {
    return [...this.items.values()].filter((r) => statuses.includes(r.status)).map((r) => structuredClone(r));
  }

  /** Wait until everything changed so far is on disk (used at shutdown). */
  async flush(): Promise<void> {
    await (this.queued ?? this.running).catch(() => undefined);
  }

  /**
   * One write at a time. Changes made while a write is running share the
   * next write, which starts after it and so contains all of them.
   */
  private persist(): Promise<void> {
    if (this.queued) return this.queued;
    const p: Promise<void> = this.running
      .catch(() => undefined)
      .then(() => {
        this.queued = undefined;
        return this.writeNow();
      });
    this.queued = p;
    this.running = p;
    return p;
  }

  private async writeNow(): Promise<void> {
    const dir = dirname(this.path);
    const tmp = join(dir, `.${basename(this.path)}.tmp-${process.pid}-${++this.seq}`);
    const data: FileShape = { version: 1, bookings: [...this.items.values()] };
    try {
      const fh = await open(tmp, 'w', 0o600);
      try {
        await fh.writeFile(JSON.stringify(data), 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, this.path);
      await syncDir(dir);
      this.lastWriteOk = true;
    } catch (err) {
      this.lastWriteOk = false;
      await unlink(tmp).catch(() => undefined);
      throw new Error(`Bookings file ${this.path}: write failed: ${message(err)}`);
    }
  }

  private async removeStaleTempFiles(): Promise<void> {
    const dir = dirname(this.path);
    const prefix = `.${basename(this.path)}.tmp-`;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (name.startsWith(prefix)) await unlink(join(dir, name)).catch(() => undefined);
    }
  }
}

function parse(text: string, path: string): BookingRecord[] {
  const corrupt = (why: string) =>
    new Error(`Bookings file ${path} is corrupt (${why}). Refusing to start empty over existing data; restore it from a backup or move it away by hand.`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw corrupt(message(err));
  }
  const list = (data as Partial<FileShape> | null)?.bookings;
  if (!data || typeof data !== 'object' || (data as FileShape).version !== 1 || !Array.isArray(list)) throw corrupt('unexpected format');
  const seen = new Set<string>();
  for (const r of list as Partial<BookingRecord>[]) {
    const ok =
      r && typeof r === 'object' && typeof r.clientReference === 'string' && r.clientReference !== '' &&
      typeof r.status === 'string' && STATUSES.has(r.status) && typeof r.supplierId === 'string' &&
      Array.isArray(r.history) && !!r.offer && !!r.total;
    if (!ok) throw corrupt('a booking record is incomplete');
    if (seen.has(r.clientReference!)) throw corrupt(`booking ${r.clientReference} appears twice`);
    seen.add(r.clientReference!);
  }
  return list;
}

/** fsync the directory so the rename itself survives a power cut. Not every file system allows it. */
async function syncDir(dir: string): Promise<void> {
  try {
    const dh = await open(dir, 'r');
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    /* best effort */
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

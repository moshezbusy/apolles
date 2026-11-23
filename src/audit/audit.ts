import { access, appendFile, chmod, constants, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * One entry per supplier HTTP call, already redacted. This is what you show
 * the supplier during certification and what you check when a hotel says
 * "we never got that booking".
 */
export interface AuditEntry {
  at: string;
  requestId: string;
  supplierId: string;
  operation: string;
  attempt: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status?: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  /** Which bodies were cut because they were very large (the text itself ends with the full size). */
  truncated?: ('requestBody' | 'responseBody')[];
}

export interface AuditSink {
  record(entry: AuditEntry): void | Promise<void>;
}

/** Largest request/response body kept per log entry unless configured otherwise. */
export const DEFAULT_AUDIT_BODY_BYTES = 256 * 1024;
/** Day files older than this are deleted (two years: suppliers ask for 12 to 24 months). */
export const DEFAULT_AUDIT_RETENTION_DAYS = 730;

/** Cut a very large body for the log. One 20 MB search answer per call would fill the disk. */
export function truncateForAudit(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return { text, truncated: false };
  const kept = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  return { text: `${kept}\n[truncated: first ${maxBytes} of ${bytes} bytes kept]`, truncated: true };
}

export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * Writes one JSON line per call into <dir>/<YYYY-MM-DD>.jsonl. The log holds
 * guest names and booking details, so the directory is 0700 and the files
 * 0600: only the service's own user can read them.
 */
export class JsonlFileAuditSink implements AuditSink {
  private ready: Promise<void> | undefined;
  private readonly secured = new Set<string>();
  private readonly retentionDays: number;
  private readonly now: () => Date;

  constructor(private readonly dir: string, opts: { retentionDays?: number; now?: () => Date } = {}) {
    this.retentionDays = opts.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
    this.now = opts.now ?? (() => new Date());
  }

  /** Create and lock down the directory. Call at startup: a log that cannot be written must stop the start. */
  init(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await chmod(this.dir, 0o700);
        await access(this.dir, constants.W_OK);
      } catch (err) {
        throw new Error(`Audit log directory ${this.dir} cannot be created or written: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return this.ready;
  }

  async record(entry: AuditEntry): Promise<void> {
    await this.init();
    const file = join(this.dir, `${entry.at.slice(0, 10)}.jsonl`);
    await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    if (!this.secured.has(file)) {
      // `mode` only applies when the file is created; a file from an older version may be wider.
      await chmod(file, 0o600);
      this.secured.add(file);
    }
  }

  /** Delete day files older than the retention. Returns how many were deleted. */
  async sweep(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * 86_400_000).toISOString().slice(0, 10);
    let deleted = 0;
    for (const name of await readdir(this.dir)) {
      const day = DAY_FILE.exec(name)?.[1];
      if (!day || day >= cutoff) continue;
      await unlink(join(this.dir, name));
      deleted += 1;
    }
    return deleted;
  }

  /** Sweep now and then once a day. The timer does not keep the process alive. */
  startRetention(log: (msg: string) => void = (m) => console.error(m)): () => void {
    const run = () => {
      this.sweep().catch((err) => log(`Audit log retention sweep failed: ${err instanceof Error ? err.message : String(err)}`));
    };
    run();
    const timer = setInterval(run, 86_400_000);
    timer.unref();
    return () => clearInterval(timer);
  }
}

export class NullAuditSink implements AuditSink {
  record(): void {}
}

/**
 * Wraps the real sink. A booking must never fail because the log could not
 * be written, but that must not be silent either: the failure is logged (at
 * most once every 10 minutes while it lasts), `ok` turns false (shown in
 * GET /health) and `onFailure` is called (the alert webhook).
 */
export class MonitoredAuditSink implements AuditSink {
  private healthy = true;
  private lastReported = -Infinity;
  private readonly log: (msg: string) => void;
  private readonly onFailure: (msg: string) => void;
  private readonly now: () => number;
  private readonly repeatMs: number;

  constructor(
    private readonly inner: AuditSink,
    opts: { log?: (msg: string) => void; onFailure?: (msg: string) => void; now?: () => number; repeatMs?: number } = {},
  ) {
    this.log = opts.log ?? ((m) => console.error(m));
    this.onFailure = opts.onFailure ?? (() => undefined);
    this.now = opts.now ?? Date.now;
    this.repeatMs = opts.repeatMs ?? 10 * 60_000;
  }

  /** False while the last write failed. */
  get ok(): boolean {
    return this.healthy;
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.inner.record(entry);
      this.healthy = true;
    } catch (err) {
      this.healthy = false;
      const now = this.now();
      if (now - this.lastReported < this.repeatMs) return;
      this.lastReported = now;
      const msg = `Audit log cannot be written: ${err instanceof Error ? err.message : String(err)}`;
      this.log(msg);
      try {
        this.onFailure(msg);
      } catch {
        /* reporting must not break the call either */
      }
    }
  }
}

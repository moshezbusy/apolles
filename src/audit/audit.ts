import { appendFile, mkdir } from 'node:fs/promises';
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
}

export interface AuditSink {
  record(entry: AuditEntry): void | Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

/** Writes one JSON line per call into <dir>/<YYYY-MM-DD>.jsonl. */
export class JsonlFileAuditSink implements AuditSink {
  private ready: Promise<unknown>;
  constructor(private readonly dir: string) {
    this.ready = mkdir(dir, { recursive: true });
  }
  async record(entry: AuditEntry): Promise<void> {
    await this.ready;
    const file = join(this.dir, `${entry.at.slice(0, 10)}.jsonl`);
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export class NullAuditSink implements AuditSink {
  record(): void {}
}

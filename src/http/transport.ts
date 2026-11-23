import { SupplierError } from '../core/errors.js';
import type { CallContext } from '../core/supplier.js';
import type { AuditSink } from '../audit/audit.js';
import { NullAuditSink } from '../audit/audit.js';
import { redactHeaders, redactText } from '../security/redact.js';
import { TokenBucket } from './rate-limit.js';

export interface HttpRequest {
  /** Logical operation for the audit log: search, checkRate, book, ... */
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /**
   * True for calls that are safe to repeat (search, read). Book and cancel
   * are NOT: a timeout there becomes OUTCOME_UNKNOWN and is never retried.
   */
  idempotent: boolean;
  /**
   * Secret values (API keys, secrets) to mask wherever they appear in the
   * audit log, including supplier responses that echo them back.
   */
  sensitiveValues?: string[];
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

export interface TransportOptions {
  supplierId: string;
  audit?: AuditSink;
  /** Max attempts for idempotent calls (1 = no retry). */
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Requests per second allowed by the supplier contract. */
  rateLimitPerSecond?: number;
  fetchImpl?: typeof fetch;
  /** Responses bigger than this are refused (protects memory). */
  maxResponseBytes?: number;
}

export class HttpTransport {
  private readonly supplierId: string;
  private readonly audit: AuditSink;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly limiter?: TokenBucket;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;

  constructor(opts: TransportOptions) {
    this.supplierId = opts.supplierId;
    this.audit = opts.audit ?? new NullAuditSink();
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.baseDelayMs = opts.baseDelayMs ?? 200;
    this.limiter = opts.rateLimitPerSecond ? new TokenBucket(opts.rateLimitPerSecond) : undefined;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxResponseBytes = opts.maxResponseBytes ?? 20 * 1024 * 1024;
  }

  async send(req: HttpRequest, ctx: CallContext): Promise<HttpResponse> {
    if (!req.url.startsWith('https://') && !isLocal(req.url)) {
      throw new SupplierError(this.supplierId, 'VALIDATION', `Refusing non-HTTPS supplier URL for ${req.operation}`);
    }
    const attempts = req.idempotent ? this.maxAttempts : 1;
    let lastError: SupplierError | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(this.backoff(attempt), ctx.signal);
      try {
        const res = await this.once(req, ctx, attempt);
        if (res.status === 429 || res.status >= 500) {
          lastError = new SupplierError(
            this.supplierId,
            res.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE',
            `${req.operation}: HTTP ${res.status}`,
          );
          if (!req.idempotent) throw this.unknownOutcome(req, lastError);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          throw new SupplierError(this.supplierId, 'AUTH', `${req.operation}: HTTP ${res.status}`);
        }
        return res;
      } catch (err) {
        if (err instanceof SupplierError) {
          // A redirect or an oversized answer to book/cancel tells us nothing
          // about whether the supplier processed it.
          if (!req.idempotent && err.code === 'PROTOCOL') throw this.unknownOutcome(req, err);
          if (err.code === 'OUTCOME_UNKNOWN' || !err.retryable) throw err;
          if (!req.idempotent) throw this.unknownOutcome(req, err);
          lastError = err;
          continue;
        }
        if (ctx.signal?.aborted) throw err;
        const wrapped = classifyNetworkError(this.supplierId, req.operation, err);
        if (!req.idempotent) throw this.unknownOutcome(req, wrapped);
        lastError = wrapped;
      }
    }
    throw lastError ?? new SupplierError(this.supplierId, 'UNAVAILABLE', `${req.operation} failed`);
  }

  private async once(req: HttpRequest, ctx: CallContext, attempt: number): Promise<HttpResponse> {
    await this.limiter?.take(ctx.signal);
    const started = Date.now();
    const timeout = AbortSignal.timeout(req.timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    const headers = req.headers ?? {};
    let status: number | undefined;
    let body: string | undefined;
    let error: string | undefined;
    try {
      ctx.onSend?.(); // from here on the supplier may have seen the request
      // Never follow a redirect: it could send credentials, card data or a
      // booking to a host that is not the supplier we configured.
      const res = await this.fetchImpl(req.url, { method: req.method, headers, body: req.body, signal, redirect: 'error' });
      status = res.status;
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        throw new SupplierError(this.supplierId, 'PROTOCOL', `${req.operation}: redirect refused (HTTP ${res.status})`);
      }
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > this.maxResponseBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new SupplierError(this.supplierId, 'PROTOCOL', `${req.operation}: response too large`);
      }
      body = await this.readLimited(res, req.operation);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (resHeaders[k] = v));
      return { status: res.status, headers: resHeaders, body, durationMs: Date.now() - started };
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (timeout.aborted && !ctx.signal?.aborted) {
        throw new SupplierError(this.supplierId, 'TIMEOUT', `${req.operation}: timed out after ${req.timeoutMs}ms`, { cause: err });
      }
      if (isRedirectError(err)) {
        throw new SupplierError(this.supplierId, 'PROTOCOL', `${req.operation}: redirect refused`, { cause: err });
      }
      throw err;
    } finally {
      const mask = (t: string) => maskValues(redactText(t), req.sensitiveValues);
      await Promise.resolve(
        this.audit.record({
          at: new Date(started).toISOString(),
          requestId: ctx.requestId,
          supplierId: this.supplierId,
          operation: req.operation,
          attempt,
          method: req.method,
          url: mask(req.url),
          requestHeaders: redactHeaders(headers),
          requestBody: req.body === undefined ? undefined : mask(req.body),
          status,
          responseBody: body === undefined ? undefined : mask(body),
          durationMs: Date.now() - started,
          error: error === undefined ? undefined : mask(error),
        }),
      ).catch(() => {
        /* audit must never break a booking */
      });
    }
  }

  /**
   * Read the body chunk by chunk and stop as soon as it is bigger than the
   * limit. Counts bytes after decompression, so neither a missing
   * content-length nor a tiny gzip that unpacks to gigabytes fills memory.
   */
  private async readLimited(res: Response, operation: string): Promise<string> {
    if (!res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SupplierError(this.supplierId, 'PROTOCOL', `${operation}: response too large`);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }

  private unknownOutcome(req: HttpRequest, cause: SupplierError): SupplierError {
    return new SupplierError(
      this.supplierId,
      'OUTCOME_UNKNOWN',
      `${req.operation}: ${cause.message}. The supplier may have processed it; reconcile before retrying.`,
      { cause },
    );
  }

  private backoff(attempt: number): number {
    const exp = this.baseDelayMs * 2 ** (attempt - 2);
    return exp + Math.floor(Math.random() * this.baseDelayMs);
  }
}

function classifyNetworkError(supplierId: string, operation: string, err: unknown): SupplierError {
  const msg = err instanceof Error ? err.message : String(err);
  return new SupplierError(supplierId, 'UNAVAILABLE', `${operation}: network error: ${msg}`, { cause: err });
}

/** What fetch throws for a 3xx when told `redirect: 'error'` ("fetch failed", cause "unexpected redirect"). */
function isRedirectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = err.cause instanceof Error ? err.cause.message : '';
  return /redirect/i.test(`${err.message} ${cause}`);
}

function maskValues(text: string, values: string[] | undefined): string {
  let out = text;
  for (const v of values ?? []) {
    if (v && v.length >= 6) out = out.split(v).join('***');
  }
  return out;
}

function isLocal(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

import type { SupplierId } from './types.js';

export type SupplierErrorCode =
  /** Bad credentials / not allowed. Not retryable. */
  | 'AUTH'
  /** We sent something the supplier rejected. Not retryable. */
  | 'VALIDATION'
  /** Room/rate no longer available. */
  | 'SOLD_OUT'
  /** Price changed between quote and book. */
  | 'RATE_CHANGED'
  /** Supplier down / 5xx / network error on a safe-to-repeat call. */
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  /** Timeout on a read call (search, quote, getBooking). */
  | 'TIMEOUT'
  /**
   * A write call (book/cancel) failed in a way that means it MAY have
   * succeeded at the supplier. Must be reconciled, never retried blindly.
   */
  | 'OUTCOME_UNKNOWN'
  | 'NOT_FOUND'
  /** Response we could not understand. */
  | 'PROTOCOL';

const RETRYABLE: ReadonlySet<SupplierErrorCode> = new Set(['UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT']);

export class SupplierError extends Error {
  readonly code: SupplierErrorCode;
  readonly supplierId: SupplierId;
  readonly supplierCode?: string;
  readonly retryable: boolean;

  constructor(
    supplierId: SupplierId,
    code: SupplierErrorCode,
    message: string,
    opts: { supplierCode?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'SupplierError';
    this.supplierId = supplierId;
    this.code = code;
    this.supplierCode = opts.supplierCode;
    this.retryable = RETRYABLE.has(code);
  }

  get outcomeUnknown(): boolean {
    return this.code === 'OUTCOME_UNKNOWN';
  }
}

/** Errors in the request coming from Apolles itself (bad input, expired quote). */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.status = status;
  }
}

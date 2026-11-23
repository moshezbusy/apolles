import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { RequestError, SupplierError } from '../core/errors.js';
import type { BookRequest, SearchRequest } from '../core/types.js';
import { parseQuoteRequest } from '../core/validate.js';
import type { SupplierService } from '../service/supplier-service.js';

const MAX_BODY = 256 * 1024;

/**
 * Small JSON API the CRM (or n8n) calls. Every request needs the
 * x-api-key header. Put it behind HTTPS (reverse proxy) in production.
 *
 *   POST /v1/search                     SearchRequest -> SearchResult
 *   POST /v1/quotes        {offerId}    -> Quote
 *   POST /v1/bookings                   BookRequest -> BookingRecord
 *   GET  /v1/bookings/:ref              -> BookingRecord
 *   POST /v1/bookings/:ref/cancel       -> BookingRecord
 *   POST /v1/reconcile                  settle UNKNOWN bookings (cron)
 *   GET  /health
 */
export function createHttpServer(service: SupplierService, apiKey: string): Server {
  if (!apiKey || apiKey.length < 24) throw new Error('API key must be at least 24 characters');
  const keyBuf = Buffer.from(apiKey);

  return createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    try {
      const url = parseUrl(req.url);
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (!authorized(req, keyBuf)) return send(res, 401, { error: 'UNAUTHORIZED' });

      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'POST' && url.pathname === '/v1/search') {
        return send(res, 200, await service.search((await readJson(req)) as SearchRequest, requestId));
      }
      if (req.method === 'POST' && url.pathname === '/v1/quotes') {
        const { offerId } = parseQuoteRequest(await readJson(req));
        return send(res, 200, await service.quote(offerId, requestId));
      }
      if (req.method === 'POST' && url.pathname === '/v1/bookings') {
        return send(res, 201, await service.book((await readJson(req)) as BookRequest, requestId));
      }
      if (parts[0] === 'v1' && parts[1] === 'bookings' && parts[2]) {
        const ref = decodePathPart(parts[2]);
        if (req.method === 'GET' && parts.length === 3) return send(res, 200, await service.getBooking(ref));
        if (req.method === 'POST' && parts[3] === 'cancel' && parts.length === 4) return send(res, 200, await service.cancel(ref, requestId));
      }
      if (req.method === 'POST' && url.pathname === '/v1/reconcile') {
        return send(res, 200, { bookings: await service.reconcilePending() });
      }
      return send(res, 404, { error: 'NOT_FOUND' });
    } catch (err) {
      if (err instanceof RequestError) return send(res, err.status, { error: err.code, message: err.message });
      if (err instanceof SupplierError) {
        return send(res, 502, { error: `SUPPLIER_${err.code}`, supplierId: err.supplierId, message: err.message, requestId });
      }
      console.error(`[${requestId}]`, err);
      return send(res, 500, { error: 'INTERNAL', requestId });
    }
  });
}

function parseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw ?? '/', 'http://local');
  } catch {
    throw new RequestError('INVALID_REQUEST', 'Invalid URL');
  }
}

/** "%zz" or a cut-off %-sequence is the caller's mistake: 400, not a crash. */
function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new RequestError('INVALID_REQUEST', 'Invalid %-encoding in the URL');
  }
}

function authorized(req: IncomingMessage, key: Buffer): boolean {
  const given = req.headers['x-api-key'];
  if (typeof given !== 'string') return false;
  const buf = Buffer.from(given);
  return buf.length === key.length && timingSafeEqual(buf, key);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!type.includes('application/json')) throw new RequestError('INVALID_REQUEST', 'content-type must be application/json', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new RequestError('INVALID_REQUEST', 'Body too large', 413);
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError('INVALID_REQUEST', 'Invalid JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(json);
}

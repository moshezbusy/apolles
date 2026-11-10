import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { forLog, maskQuery } from "@/server/supplier/mask";
import { TEST_BASE_URL, readExpediaConfig } from "./config";
import { authHeader } from "./signature";

// The one HTTP client for Expedia Rapid v3. It signs every call, sends the required headers,
// applies a timeout, retries an idempotent GET once on a 5xx or network failure, maps failures
// to typed errors, and writes every attempt to SupplierCallLog with personal data masked.
// Error messages carry only the status: never the shared secret or a response body (which
// can hold guest data).

export class SupplierError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}
export class SupplierAuthError extends SupplierError {}
export class SupplierRateLimited extends SupplierError {}
export class SupplierRequestRejected extends SupplierError {}
export class SupplierUnavailable extends SupplierError {}
export class SupplierTimeout extends SupplierError {}
// A call that may have changed something at Expedia (POST/PUT/DELETE) ended without a clear
// answer: timeout, network error, 5xx, or a body that never arrived. The booking (or the
// cancellation) may exist, so callers must reconcile and never retry blindly.
export class SupplierOutcomeUnknown extends SupplierError {}

export type RequestContext = {
  customerIp?: string; // the agent's IP, not ours
  userAgent?: string; // the agent's browser User-Agent
  sessionId?: string; // one value per agent session (Customer-Session-Id)
  test?: string; // Rapid "Test" header value; required outside production for non-GET calls
};

export type ExpediaRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string; // e.g. "/properties/availability"
  query?: Record<string, string | number | boolean | (string | number)[] | undefined>;
  body?: unknown;
  context: RequestContext;
  timeoutMs: number;
  affiliateReferenceId?: string;
};

const FALLBACK_USER_AGENT = "Apolles/1.0";

function buildUrl(baseUrl: string, path: string, query: ExpediaRequest["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ""}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: true, bytes: text.length };
  }
}

async function writeLog(entry: {
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  affiliateReferenceId: string | undefined;
  requestBody: unknown;
  responseBody?: unknown;
  error?: "timeout" | "network";
}): Promise<string | null> {
  const requestBody = forLog(entry.requestBody) as Prisma.InputJsonValue | undefined;
  const responseBody = forLog(entry.responseBody) as Prisma.InputJsonValue | undefined;
  try {
    const row = await db.supplierCallLog.create({
      data: {
        supplier: "expedia",
        method: entry.method,
        path: entry.path,
        status: entry.status,
        durationMs: entry.durationMs,
        affiliateReferenceId: entry.affiliateReferenceId ?? null,
        ...(requestBody !== undefined ? { requestBody } : {}),
        ...(responseBody !== undefined ? { responseBody } : {}),
        error: entry.error ?? null,
      },
      select: { id: true },
    });
    return row.id;
  } catch {
    // A failed log write must never fail the supplier call (or hide its result).
    console.error("supplier log write failed");
    return null;
  }
}

// Records the names of response fields the adapter did not know (and dropped).
// Array indices are removed and names de-duplicated first, so one new field repeated across
// 250 properties takes one slot instead of hiding every other name.
export async function recordUnknownFields(logId: string | null, names: string[]): Promise<void> {
  if (!logId || names.length === 0) return;
  const unique = [...new Set(names.map((name) => name.replace(/\[\d+\]/g, "[]").replace(/^\[\]\.?/, "")))];
  try {
    await db.supplierCallLog.update({ where: { id: logId }, data: { unknownFields: unique.slice(0, 200) } });
  } catch {
    console.error("supplier log update failed");
  }
}

export async function expediaRequest(
  request: ExpediaRequest,
): Promise<{ status: number; data: unknown; logId: string | null }> {
  const config = readExpediaConfig();
  const { method, path, context } = request;
  const changesState = method !== "GET";
  // On test.ean.com a booking WITHOUT the Test header is a real booking. A call that changes
  // something must carry it outside production, and always when the endpoint is the test one.
  if (changesState && !context.test && (!config.production || config.baseUrl === TEST_BASE_URL)) {
    throw new Error("Every non-GET Expedia call to the test endpoint must send the Test header");
  }

  const url = buildUrl(config.baseUrl, path, request.query);
  const logPath = maskQuery(url.slice(config.baseUrl.length));
  const attempts = changesState ? 1 : 2;

  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: authHeader(config.apiKey, config.sharedSecret, Date.now() / 1000),
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "User-Agent": context.userAgent || FALLBACK_USER_AGENT,
    };
    if (context.customerIp) headers["Customer-Ip"] = context.customerIp;
    if (context.sessionId) headers["Customer-Session-Id"] = context.sessionId;
    if (context.test) headers.Test = context.test;
    if (request.body !== undefined) headers["Content-Type"] = "application/json";

    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let status: number;
    let data: unknown;
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      status = response.status;
      data = await readBody(response); // the timeout covers the body too
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      await writeLog({
        method,
        path: logPath,
        status: null,
        durationMs: elapsed(),
        affiliateReferenceId: request.affiliateReferenceId,
        requestBody: request.body,
        error: timedOut ? "timeout" : "network",
      });
      if (changesState) {
        throw new SupplierOutcomeUnknown(`Expedia ${method} ${path}: no clear answer (${timedOut ? "timeout" : "network"})`);
      }
      if (timedOut) throw new SupplierTimeout(`Expedia ${method} ${path} timed out`);
      if (attempt < attempts) continue;
      throw new SupplierUnavailable(`Expedia ${method} ${path} could not be reached`);
    }

    const logId = await writeLog({
      method,
      path: logPath,
      status,
      durationMs: elapsed(),
      affiliateReferenceId: request.affiliateReferenceId,
      requestBody: request.body,
      responseBody: data,
    });

    if (status >= 200 && status < 300) return { status, data, logId };
    if (status === 401 || status === 403) throw new SupplierAuthError(`Expedia refused the credentials (HTTP ${status})`, status);
    if (status === 429) throw new SupplierRateLimited("Expedia rate limit reached (HTTP 429)", status);
    if (status >= 500) {
      if (changesState) throw new SupplierOutcomeUnknown(`Expedia ${method} ${path}: no clear answer (HTTP ${status})`, status);
      if (attempt < attempts) continue;
      throw new SupplierUnavailable(`Expedia ${method} ${path} failed (HTTP ${status})`, status);
    }
    throw new SupplierRequestRejected(`Expedia rejected ${method} ${path} (HTTP ${status})`, status);
  }
}

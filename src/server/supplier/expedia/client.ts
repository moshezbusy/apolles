import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { forLog } from "@/server/supplier/mask";
import { readExpediaConfig } from "./config";
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
}): Promise<void> {
  const requestBody = forLog(entry.requestBody) as Prisma.InputJsonValue | undefined;
  const responseBody = forLog(entry.responseBody) as Prisma.InputJsonValue | undefined;
  try {
    await db.supplierCallLog.create({
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
    });
  } catch {
    // A failed log write must never fail the supplier call (or hide its result).
    console.error("supplier log write failed");
  }
}

export async function expediaRequest(request: ExpediaRequest): Promise<{ status: number; data: unknown }> {
  const config = readExpediaConfig();
  const { method, path, context } = request;
  if (!config.production && method !== "GET" && !context.test) {
    // On test.ean.com a booking WITHOUT the Test header is a real booking.
    throw new Error("Outside production every non-GET Expedia call must send the Test header");
  }

  const url = buildUrl(config.baseUrl, path, request.query);
  const logPath = url.slice(config.baseUrl.length);
  const attempts = method === "GET" ? 2 : 1;

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
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      await writeLog({
        method,
        path: logPath,
        status: null,
        durationMs: Math.round(performance.now() - started),
        affiliateReferenceId: request.affiliateReferenceId,
        requestBody: request.body,
        error: timedOut ? "timeout" : "network",
      });
      if (timedOut) throw new SupplierTimeout(`Expedia ${method} ${path} timed out`);
      if (attempt < attempts) continue;
      throw new SupplierUnavailable(`Expedia ${method} ${path} could not be reached`);
    }

    const data = await readBody(response);
    await writeLog({
      method,
      path: logPath,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      affiliateReferenceId: request.affiliateReferenceId,
      requestBody: request.body,
      responseBody: data,
    });

    const { status } = response;
    if (status >= 200 && status < 300) return { status, data };
    if (status === 401 || status === 403) throw new SupplierAuthError(`Expedia refused the credentials (HTTP ${status})`, status);
    if (status === 429) throw new SupplierRateLimited("Expedia rate limit reached (HTTP 429)", status);
    if (status >= 500) {
      if (attempt < attempts) continue;
      throw new SupplierUnavailable(`Expedia ${method} ${path} failed (HTTP ${status})`, status);
    }
    throw new SupplierRequestRejected(`Expedia rejected ${method} ${path} (HTTP ${status})`, status);
  }
}

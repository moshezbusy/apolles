import type { Prisma } from "@/generated/prisma/client";
import { removeNul } from "@/lib/strip-nul";
import { db } from "@/server/db";
import { forLog } from "@/server/supplier/mask";
import { SupplierNotSent, SupplierOutcomeUnknown, SupplierResponseTooLarge, SupplierTimeout, SupplierUnavailable } from "@/server/supplier/expedia/client";
import { type Env, type LayerConfig, readLayerConfig } from "./config";

// The one HTTP client for the supplier layer service (README of the layer: /v1/search,
// /v1/quotes, /v1/bookings). Every call carries the x-api-key header, has a timeout, never
// follows a redirect, reads at most MAX_RESPONSE_BYTES, and is written to SupplierCallLog
// (supplier "hotelbeds") with guest data masked. Nothing is ever retried here: a call that may
// have changed something at the layer (book, cancel) and got no clear answer is
// SupplierOutcomeUnknown. HTTP answers are returned as they are; the adapter decides what each
// one means. Error messages never carry a body or the key.

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024; // the layer cuts supplier answers at 20 MB too
const MASK = "[masked]";
// The layer's own names for guest data (camelCase), masked before the log is written.
const LAYER_PII_KEYS = new Set(["holder", "guests", "firstName", "lastName", "email", "phone", "specialRequests", "history", "note"]);

function maskLayer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskLayer);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, LAYER_PII_KEYS.has(key) ? (inner === null || inner === undefined ? inner : MASK) : maskLayer(inner)]));
  }
  return value;
}

export type LayerRequest = {
  method: "GET" | "POST";
  path: string; // e.g. "/v1/search"; built by the adapter from checked values only
  body?: unknown;
  timeoutMs: number;
  changesState: boolean; // book, cancel: an unclear answer is SupplierOutcomeUnknown
  affiliateReferenceId?: string;
};

export type LayerAnswer = { status: number; data: unknown };

async function readText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new SupplierResponseTooLarge(`Supplier layer answer is larger than ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function writeLog(entry: { method: string; path: string; status: number | null; durationMs: number; affiliateReferenceId?: string | undefined; requestBody: unknown; responseBody?: unknown; error?: string }): Promise<void> {
  const requestBody = forLog(maskLayer(entry.requestBody)) as Prisma.InputJsonValue | undefined;
  const responseBody = forLog(maskLayer(entry.responseBody)) as Prisma.InputJsonValue | undefined;
  try {
    await db.supplierCallLog.create({
      data: {
        supplier: "hotelbeds",
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
    console.error("supplier log write failed"); // never fails the call itself
  }
}

export async function layerRequest(request: LayerRequest, env: Env = process.env): Promise<LayerAnswer> {
  let settings: LayerConfig;
  try {
    settings = readLayerConfig(env);
  } catch (error) {
    // Nothing was sent: a definite "nothing happened" (the message names the setting only).
    throw new SupplierNotSent(error instanceof Error ? error.message : "The supplier layer settings could not be read");
  }
  const what = `Supplier layer ${request.method} ${request.path}`;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let status: number;
  let data: unknown;
  try {
    const response = await fetch(`${settings.baseUrl}${request.path}`, {
      method: request.method,
      headers: {
        "x-api-key": settings.apiKey,
        Accept: "application/json",
        ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    status = response.status;
    const text = await readText(response); // the timeout covers the body too
    try {
      data = text ? JSON.parse(text, (_key, value: unknown) => (typeof value === "string" ? removeNul(value) : value)) : undefined;
    } catch {
      data = undefined; // not JSON: the adapter treats an unreadable answer as unclear
    }
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const tooLarge = error instanceof SupplierResponseTooLarge;
    const kind = timedOut ? "timeout" : tooLarge ? "too_large" : "network";
    await writeLog({ method: request.method, path: request.path, status: null, durationMs: elapsed(), affiliateReferenceId: request.affiliateReferenceId, requestBody: request.body, error: kind });
    if (request.changesState) throw new SupplierOutcomeUnknown(`${what}: no clear answer (${kind})`);
    if (tooLarge) throw error;
    if (timedOut) throw new SupplierTimeout(`${what} timed out`);
    throw new SupplierUnavailable(`${what} could not be reached`);
  }
  await writeLog({ method: request.method, path: request.path, status, durationMs: elapsed(), affiliateReferenceId: request.affiliateReferenceId, requestBody: request.body, responseBody: data });
  return { status, data };
}

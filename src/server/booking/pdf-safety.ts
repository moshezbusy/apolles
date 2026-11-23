import { type RateLimitResult, hitRateLimit } from "@/server/rate-limit";

// A PDF that is still not finished after this long will never finish (pdfkit ends its stream
// only when every image has been decoded, and a decode error inside one of its callbacks is
// lost). The request then fails with a clear error instead of hanging until the proxy gives up.

export const PDF_TIMEOUT_MS = 10_000;

export class PdfTimeout extends Error {
  constructor() {
    super("PDF generation timed out");
    this.name = "PdfTimeout";
  }
}

export function withPdfTimeout<T>(pdf: Promise<T>, ms: number = PDF_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PdfTimeout()), ms);
  });
  return Promise.race([pdf, timeout]).finally(() => clearTimeout(timer));
}

// Making a PDF costs CPU and memory, so each agency gets a generous but finite number of
// downloads: far more than an agent printing vouchers needs, far fewer than a script in a loop.
export const DOCUMENT_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

export function hitDocumentLimit(kind: "voucher" | "statement", agencyId: string): Promise<RateLimitResult> {
  return hitRateLimit(`${kind}:agency:${agencyId}`, DOCUMENT_LIMIT.limit, DOCUMENT_LIMIT.windowMs);
}

// Headers for every answer of a document route: never cached, never guessed to be another type.
export const DOCUMENT_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

export function tooManyDocuments(retryAfterMs: number): Response {
  return new Response("Too many downloads in a short time. Try again in a few minutes.", {
    status: 429,
    headers: { ...DOCUMENT_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
  });
}

export function documentUnavailable(): Response {
  return new Response("The document could not be made right now. Try again in a few minutes.", {
    status: 503,
    headers: { ...DOCUMENT_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

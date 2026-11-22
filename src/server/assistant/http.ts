import { getClientIp } from "@/server/client-ip";
import { hitRateLimit } from "@/server/rate-limit";

// Small helpers shared by the assistant connector's route handlers.

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function notFound(): Response {
  return new Response("Not found", { status: 404, headers: NO_STORE });
}

// The body as text, or null when it is larger than `max` bytes. Stops reading at the limit, so
// a huge body is never held in memory.
export async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

// Per-IP limit for the public OAuth endpoints (registration, token).
export async function ipAllowed(request: Request, action: string, limit: number, windowMs: number): Promise<boolean> {
  const ip = getClientIp(request.headers);
  const { allowed } = await hitRateLimit(`${action}:ip:${ip}`, limit, windowMs);
  return allowed;
}

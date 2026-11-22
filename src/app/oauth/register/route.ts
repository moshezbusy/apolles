import { aiSearchEnabled } from "@/server/ai/config";
import { readCappedText, registerClient } from "@/server/ai/clients";
import { getClientIp } from "@/server/client-ip";

// Dynamic Client Registration (RFC 7591) for Claude and ChatGPT. Open registration, but only
// with allowlisted redirect URIs and a public client (rules in src/server/ai/clients.ts).
// Off (AI_SEARCH_ENABLED not "true") → 404 for every method, as if the route did not exist.

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function notFound(): Response {
  return new Response(null, { status: 404, headers: NO_STORE });
}

function isJson(contentType: string | null): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// The parsed JSON body, or undefined when it is not JSON, too large or of another type.
// undefined is then refused by registerClient (after it counts the request).
async function readJsonBody(request: Request): Promise<unknown> {
  if (!isJson(request.headers.get("content-type"))) return undefined;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
  const text = await readCappedText(request.body, MAX_BODY_BYTES);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!aiSearchEnabled()) return notFound();
  const body = await readJsonBody(request);
  const result = await registerClient(body, getClientIp(request.headers));
  return Response.json(result.json, { status: result.status, headers: NO_STORE });
}

function methodNotAllowed(): Response {
  if (!aiSearchEnabled()) return notFound();
  return new Response(null, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

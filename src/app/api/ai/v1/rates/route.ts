import { aiApiClosed, aiRates, aiMethodNotAllowed, aiNotFound, handleAiRequest } from "@/server/ai/search-api";

// Internal AI API: the MCP server's `get_hotel_rates` tool (rules in src/server/ai/search-api.ts).
// Called only by the MCP server, with its service key and the agent's search token. Off, or a
// request that came through the public proxy → 404 for every method.

export async function POST(request: Request): Promise<Response> {
  if (aiApiClosed(request)) return aiNotFound();
  return handleAiRequest(request, (auth, body) => aiRates(auth, body));
}

async function methodNotAllowed(request: Request): Promise<Response> {
  if (aiApiClosed(request)) return aiNotFound();
  return aiMethodNotAllowed();
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
// Next.js would otherwise answer OPTIONS itself (204 + Allow), even while the feature is off.
export const OPTIONS = methodNotAllowed;

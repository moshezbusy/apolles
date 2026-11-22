import { aiSearchEnabled } from "@/server/ai/config";
import { aiRates, aiMethodNotAllowed, aiNotFound, handleAiRequest } from "@/server/ai/search-api";

// Internal AI API: the MCP server's `get_hotel_rates` tool (rules in src/server/ai/search-api.ts).
// Called only by the MCP server, with its service key and the agent's search token. Off → 404
// for every method.

export async function POST(request: Request): Promise<Response> {
  if (!aiSearchEnabled()) return aiNotFound();
  return handleAiRequest(request, (auth, body) => aiRates(auth, body));
}

async function methodNotAllowed(): Promise<Response> {
  if (!aiSearchEnabled()) return aiNotFound();
  return aiMethodNotAllowed();
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
// Next.js would otherwise answer OPTIONS itself (204 + Allow), even while the feature is off.
export const OPTIONS = methodNotAllowed;

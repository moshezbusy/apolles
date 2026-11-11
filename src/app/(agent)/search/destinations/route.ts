import { requireAgent } from "@/server/auth/guards";
import { hitRateLimit } from "@/server/rate-limit";
import { suggestDestinations } from "@/server/search/destinations";

// Destination suggestions for the search box. Agents only; 120 a minute per agency (one per
// key press, after a short pause). Destinations are not agency data, but the list is ours.

const LIMIT = { limit: 120, windowMs: 60_000 };

export async function GET(request: Request): Promise<Response> {
  const { agencyId } = await requireAgent();
  const { allowed } = await hitRateLimit(`destinations:agency:${agencyId}`, LIMIT.limit, LIMIT.windowMs);
  if (!allowed) return Response.json({ destinations: [] }, { status: 429, headers: { "Cache-Control": "no-store" } });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const destinations = await suggestDestinations(q.slice(0, 60), 8);
  return Response.json({ destinations }, { headers: { "Cache-Control": "no-store" } });
}

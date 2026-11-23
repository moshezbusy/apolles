import { requireAgent } from "@/server/auth/guards";
import { hitRateLimit } from "@/server/rate-limit";
import { suggestDestinations } from "@/server/search/destinations";

// Destination suggestions for the search box. Agents only; 120 a minute per user (one per key
// press, after a short pause), so one agent typing never empties a colleague's list; 600 a
// minute per agency as a backstop. The user's own limit is counted first: an agent over it does
// not use up the agency's. Destinations are not agency data, but the list is ours.

const PER_USER = { limit: 120, windowMs: 60_000 };
const PER_AGENCY = { limit: 600, windowMs: 60_000 };

export async function GET(request: Request): Promise<Response> {
  const { agencyId, userId } = await requireAgent();
  const limited = () => Response.json({ destinations: [] }, { status: 429, headers: { "Cache-Control": "no-store" } });
  if (!(await hitRateLimit(`destinations:user:${userId}`, PER_USER.limit, PER_USER.windowMs)).allowed) return limited();
  if (!(await hitRateLimit(`destinations:agency:${agencyId}`, PER_AGENCY.limit, PER_AGENCY.windowMs)).allowed) return limited();
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const destinations = await suggestDestinations(q.slice(0, 60), 8);
  return Response.json({ destinations }, { headers: { "Cache-Control": "no-store" } });
}

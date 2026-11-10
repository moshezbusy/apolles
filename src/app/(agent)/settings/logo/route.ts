import { getAgencyLogo } from "@/server/agency-profile";
import { requireAgent } from "@/server/auth/guards";

// The signed-in agent's own agency logo (for the /settings preview). The agencyId comes from
// the session only, so there is no way to ask for another agency's logo. The bytes were
// checked to be PNG or JPEG on upload; the headers still forbid the browser from guessing
// another type or running anything in the response.
export async function GET(): Promise<Response> {
  const { agencyId } = await requireAgent();
  const logo = await getAgencyLogo(agencyId);
  if (!logo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-cache" } });

  return new Response(Buffer.from(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mimeType,
      "Content-Length": String(logo.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
      ETag: `"${logo.sha256}"`,
    },
  });
}

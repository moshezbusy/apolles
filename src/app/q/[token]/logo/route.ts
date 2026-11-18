import { clientLogo } from "@/server/quotes/sharing";

// The agency's logo on the client page, found by the quote's token (no session). Same safe
// headers as the agent's own logo route: the browser may not guess another type or run anything.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const logo = await clientLogo(token);
  if (!logo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mimeType,
      "Content-Length": String(logo.sizeBytes),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
      "Referrer-Policy": "no-referrer",
    },
  });
}

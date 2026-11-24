import { getClientIp } from "@/server/client-ip";
import { startAuthorization } from "@/server/assistant/oauth";

// Where Claude or ChatGPT sends the agent to connect (OAuth authorization endpoint). The request is
// checked and kept for 10 minutes; the agent then signs in as usual (password and email code) and
// sees the consent page, /oauth/consent/<id>. Nothing is granted here.
export async function GET(request: Request): Promise<Response> {
  const result = await startAuthorization(new URL(request.url).searchParams, getClientIp(request.headers));
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (result.kind === "consent") return new Response(null, { status: 303, headers: { ...headers, Location: `/oauth/consent/${result.requestId}` } });
  if (result.kind === "redirect") return new Response(null, { status: 303, headers: { ...headers, Location: result.location } });
  return new Response(`${result.message} Start again from Claude or ChatGPT.`, { status: 400, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

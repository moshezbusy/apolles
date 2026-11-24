import { getClientIp } from "@/server/client-ip";
import { assistantConfig } from "@/server/assistant/config";
import { BROWSER_COOKIE, BROWSER_COOKIE_MAX_AGE_SECONDS, startAuthorization } from "@/server/assistant/oauth";

// Where Claude or ChatGPT sends the agent to connect (OAuth authorization endpoint). The request is
// checked and kept for 10 minutes; the agent then signs in as usual (password and email code) and
// sees the consent page, /oauth/consent/<id>. Nothing is granted here. A cookie ties the sign-in
// to this browser: the consent link works nowhere else. 404 while the connector is off.
export async function GET(request: Request): Promise<Response> {
  if (!assistantConfig()) return new Response("Not found", { status: 404 });
  const result = await startAuthorization(new URL(request.url).searchParams, getClientIp(request.headers));
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (result.kind === "consent") {
    const cookie = `${BROWSER_COOKIE}=${result.browserNonce}; Path=/; Max-Age=${BROWSER_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
    return new Response(null, { status: 303, headers: { ...headers, Location: `/oauth/consent/${result.requestId}`, "Set-Cookie": cookie } });
  }
  if (result.kind === "redirect") return new Response(null, { status: 303, headers: { ...headers, Location: result.location } });
  return new Response(`${result.message} Start again from Claude or ChatGPT.`, { status: 400, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

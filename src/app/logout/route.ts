import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/server/auth/session";

// CSRF protection for this POST: the browser's Origin header must name this same host
// (the same rule Next.js applies to server actions). No Origin header → refused.
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Sign-out ends only the current session (other devices stay signed in).
export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const rawToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (rawToken) await destroySession(rawToken);

  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

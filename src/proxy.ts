import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/return-path";

// Agent pages only: tells the page (and its server actions) its own path, so that when the
// session has ended the sign-in guard can send the agent back here after signing in again
// (src/server/auth/guards.ts). It checks nothing: every page and action still checks the
// session itself. A value sent by the browser in this header is always replaced.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/search/:path*",
    "/book/:path*",
    "/bookings/:path*",
    "/clients/:path*",
    "/quotes/:path*",
    "/balance/:path*",
    "/reporting/:path*",
    "/settings/:path*",
  ],
};

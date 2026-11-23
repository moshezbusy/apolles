// Where an agent goes back to after signing in again (the page they were on when their session
// ended). Only a path on this site is accepted: it must start with one "/" (not "//" or "/\",
// which browsers read as another site), have no spaces or control characters, and not be a
// sign-in page itself. Anything else gives null, and the caller uses the default page.
export const AFTER_SIGN_IN_PATH = "/search";
// The request header the proxy (src/proxy.ts) sets to the page's own path and query.
export const REQUEST_PATH_HEADER = "x-apolles-path";

const MAX_LENGTH = 512;
const ORIGIN = "https://apolles.invalid";

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000- \u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  if (/^\/(login|logout)(\/|$)/.test(url.pathname)) return null;
  return url.pathname + url.search;
}

// The page to open after sign-in: the safe return path, or the default.
export function afterSignInPath(raw: unknown): string {
  return safeReturnPath(raw) ?? AFTER_SIGN_IN_PATH;
}

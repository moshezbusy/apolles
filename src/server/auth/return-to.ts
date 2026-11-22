// Where the sign-in may send an agent back to (`next` on /login and /login/verify). Only the two
// pages an agent reaches from an assistant: the OAuth authorize request and a result link.
// Anything else is ignored, so a crafted sign-in link can never send someone to another site
// (no open redirect). Plan 11, design §4.1.

const MAX_LENGTH = 2000;
const ALLOWED_PREFIXES = ["/oauth/authorize?", "/search/open?"];
// Printable ASCII only: a real return path is URL-encoded, so a space, a line break or any
// other character means it was made up.
const PRINTABLE = /^[\x21-\x7e]+$/;

export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_LENGTH || !PRINTABLE.test(raw)) return null;
  if (!ALLOWED_PREFIXES.some((prefix) => raw.startsWith(prefix))) return null;
  // "//" and "\" are how browsers are tricked into another host; an encoded path never has them.
  if (raw.includes("//") || raw.includes("\\")) return null;
  return raw;
}

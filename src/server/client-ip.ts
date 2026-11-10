import { isIP } from "node:net";

// The client's IP address for rate limits, from the request headers.
//
// X-Forwarded-For is a comma-separated list that every proxy appends to, so only its right
// end can be trusted: anything to the left of what our own proxies added was sent by the
// client and may be made up. TRUSTED_PROXY_HOPS says how many proxies we run in front of the
// app (default 1: the hosting provider's proxy, which appends the real client IP). With N
// hops the client IP is the N-th entry from the right. 0 means no proxy we trust: the
// header is ignored. If the list is shorter than N, the request did not come through our
// proxies the expected way and the header is not used.
// In those cases the result is "unknown": x-real-ip is NOT used, because a client can set it
// itself (R51). The result is always a valid IPv4/IPv6 literal or
// "unknown", so a client cannot put arbitrary text into a rate-limit key.
// Never logged.

export const UNKNOWN_IP = "unknown";
const DEFAULT_HOPS = 1;

type HeaderReader = { get(name: string): string | null };

export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,2}$/.test(raw)) return DEFAULT_HOPS;
  return Number(raw);
}

// "1.2.3.4:5678" → "1.2.3.4"; "[2001:db8::1]" / "[2001:db8::1]:443" → "2001:db8::1".
// Returns null when the text is not an IP literal.
function normalizeIp(raw: string): string | null {
  let text = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(text);
  if (bracketed) {
    const inner = bracketed[1]!;
    return isIP(inner) === 6 ? inner.toLowerCase() : null;
  }
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text);
  if (withPort) text = withPort[1]!;
  const version = isIP(text);
  if (version === 4) return text;
  if (version === 6) return text.toLowerCase();
  return null;
}

function fromForwardedFor(value: string | null, hops: number): string | null {
  if (hops === 0 || value === null) return null;
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length < hops) return null;
  return entries[entries.length - hops] ?? null;
}

export function getClientIp(
  headers: HeaderReader,
  trustedProxyHops: string | undefined = process.env.TRUSTED_PROXY_HOPS,
): string {
  const hops = parseTrustedProxyHops(trustedProxyHops);
  const candidate = fromForwardedFor(headers.get("x-forwarded-for"), hops);
  if (candidate === null) return UNKNOWN_IP;
  return normalizeIp(candidate) ?? UNKNOWN_IP;
}

import type { z } from "zod";

// Shared response checking for the Expedia adapter (owner decision 2026-11-10,
// docs/decisions/2026-11-10-supplier-unknown-fields.md): every schema is built twice from one
// definition, with z.object (unknown keys dropped) for the data and z.strictObject only to list
// the unknown keys for the supplier log. Items are checked one by one, so a bad one is dropped
// and named in the log instead of failing a whole response.

export type ObjectFactory = typeof z.object;

// Notes for the supplier log: names of unknown fields, and "invalid:<path>" for dropped items.
export class ParseNotes {
  readonly names: string[] = [];
  invalid(path: string): void {
    this.names.push(`invalid:${path}`);
  }
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("").replace(/^\./, "");
}

// Checks one item. Returns null (and notes it) when it does not fit; records unknown keys.
export function check<T>(
  lenientSchema: z.ZodType<T>,
  strictSchema: z.ZodType<unknown>,
  data: unknown,
  at: string,
  notes: ParseNotes,
): T | null {
  const result = lenientSchema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    notes.invalid(`${at}${first ? `.${formatPath(first.path)}` : ""}`.replace(/^\./, ""));
    return null;
  }
  const probe = strictSchema.safeParse(data);
  if (!probe.success) {
    for (const issue of probe.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;
      const base = [at, formatPath(issue.path)].filter(Boolean).join(".");
      for (const key of issue.keys) notes.names.push(base ? `${base}.${key}` : key);
    }
  }
  return result.data;
}

// ---------- link tokens ----------
// A Rapid link ("/v3/properties/1/rooms/2/rates/3?token=…") carries a token that must go back
// exactly as given. Real tokens are long and not only letters and digits: the spec's own example
// ends in "==", and they may hold "~", "." or percent-encoded bytes ("%2F"). So the token is
// kept as it is written in the href (never decoded and encoded again) and sent back byte for
// byte. What is accepted: the characters a query value can hold without ending it (unreserved,
// "=", a few harmless sub-delimiters, and well-formed %XX), up to 4 KB. What is refused: "&" and
// "#" (they would end the value), "?", "/", spaces, control characters, a lone "%", anything
// that is not ASCII.
export const MAX_LINK_TOKEN_LENGTH = 4096;
const LINK_TOKEN = /^(?:[A-Za-z0-9._~=+:,;*!$@-]|%[0-9A-Fa-f]{2})+$/;

export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_LINK_TOKEN_LENGTH && LINK_TOKEN.test(value);
}

// One parameter of an href's query, exactly as written (not decoded). null when it is not there.
export function rawQueryValue(href: string, name: string): string | null {
  const at = href.indexOf("?");
  if (at === -1) return null;
  const query = href.slice(at + 1).split("#", 1)[0] ?? "";
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if ((eq === -1 ? part : part.slice(0, eq)) === name) return eq === -1 ? "" : part.slice(eq + 1);
  }
  return null;
}

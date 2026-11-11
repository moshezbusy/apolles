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

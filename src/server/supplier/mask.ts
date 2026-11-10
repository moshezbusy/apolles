// Masks personal data in supplier request/response bodies before they are stored in the
// supplier log. Keys are matched by name at any depth; the structure is kept so the log still
// shows what was sent. Hotel names, ids, amounts and country codes are not personal data.
const PII_KEYS = new Set([
  "given_name",
  "family_name",
  "first_name",
  "last_name",
  "email",
  "number", // phone.number
  "area_code",
  "line_1",
  "line_2",
  "line_3",
  "city",
  "postal_code",
  "special_request",
]);

const MASK = "[masked]";
export const MAX_LOG_BODY_BYTES = 256_000;

export function maskPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPii);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        PII_KEYS.has(key) && inner !== null && typeof inner !== "object" ? MASK : maskPii(inner),
      ]),
    );
  }
  return value;
}

// The masked body, or a marker when it is too large to keep whole.
export function forLog(value: unknown): unknown {
  if (value === undefined) return undefined;
  const masked = maskPii(value);
  const bytes = Buffer.byteLength(JSON.stringify(masked) ?? "", "utf8");
  return bytes > MAX_LOG_BODY_BYTES ? { truncated: true, bytes } : masked;
}

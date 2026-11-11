// Masks personal and payment data in supplier request/response bodies, and in logged query
// strings, before they are stored in the supplier log. Keys are matched by name at any depth;
// the structure is kept so the log still shows which fields were sent. Hotel names, ids,
// amounts and country codes are not personal data and stay visible.

// A leaf value under one of these keys is masked (strings, numbers, and arrays of them).
const PII_KEYS = new Set([
  "given_name",
  "family_name",
  "first_name",
  "last_name",
  "middle_name",
  "date_of_birth",
  "email",
  "number", // phone.number and payment card number
  "area_code",
  "line_1",
  "line_2",
  "line_3",
  "city",
  "postal_code",
  "special_request",
  "security_code",
  "expiration_month",
  "expiration_year",
  "loyalty_id",
  "tax_registration_number",
  "vat_number",
  "traveler_handling_instructions",
  "affiliate_metadata",
]);

// Everything under one of these keys is masked, whatever its shape.
const PII_SUBTREES = new Set(["third_party_authentication", "sensitive_traveler_details"]);

// Query parameters whose values are personal or act as a key to a booking.
const PII_QUERY_PARAMS = new Set(["email", "token"]);

const MASK = "[masked]";
export const MAX_LOG_BODY_BYTES = 256_000;

function maskLeaf(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(maskLeaf);
  return typeof value === "object" ? maskPii(value) : MASK;
}

export function maskPii(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPii);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
        if (PII_SUBTREES.has(key)) return [key, inner === null ? null : MASK];
        if (PII_KEYS.has(key)) return [key, maskLeaf(inner)];
        return [key, maskPii(inner)];
      }),
    );
  }
  return value;
}

// "/itineraries?email=a%40b.c&token=x" → "/itineraries?email=%5Bmasked%5D&token=%5Bmasked%5D".
export function maskQuery(path: string): string {
  const at = path.indexOf("?");
  if (at === -1) return path;
  const masked = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(path.slice(at + 1))) {
    masked.append(key, PII_QUERY_PARAMS.has(key) ? MASK : value);
  }
  return `${path.slice(0, at)}?${masked.toString()}`;
}

// The masked body, or a marker when it is too large to keep whole.
export function forLog(value: unknown): unknown {
  if (value === undefined) return undefined;
  const masked = maskPii(value);
  const bytes = Buffer.byteLength(JSON.stringify(masked) ?? "", "utf8");
  return bytes > MAX_LOG_BODY_BYTES ? { truncated: true, bytes } : masked;
}

// Postgres text and JSON cannot hold the NUL character. Supplier text that contains one would
// make a whole write fail, so NUL is removed from every string (object keys included).
export function stripNul<T>(value: T): T {
  if (typeof value === "string") return value.replaceAll("\u0000", "") as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replaceAll("\u0000", ""), stripNul(v)])) as T;
  }
  return value;
}

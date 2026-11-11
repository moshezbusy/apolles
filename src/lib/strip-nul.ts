// Postgres text and JSON cannot hold the NUL character. Supplier text that contains one would
// make a whole write fail, so NUL is removed from every string (object keys included).
export function removeNul(text: string): string {
  return text.split("\u0000").join("");
}

export function stripNul<T>(value: T): T {
  if (typeof value === "string") return removeNul(value) as T;
  if (Array.isArray(value)) return value.map(stripNul) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [removeNul(k), stripNul(v)])) as T;
  }
  return value;
}

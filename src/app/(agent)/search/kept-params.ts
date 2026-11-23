// What the results page keeps in its URL: the filters, the sort, the page of results and the
// quote the search adds to. Every link, form and action around the results carries these on, so
// "Load more hotels", "Apply filters", a sort change or "Back to hotels" never drops them. Only
// these names are kept, each value cut to 100 characters; the results page reads them again on
// the server (parseListOptions, quoteParam), so anything unreadable is simply ignored there.
export const KEPT_PARAMS = ["sort", "name", "room", "min", "max", "stars", "free", "cursor", "quote"] as const;

type Source = URLSearchParams | Record<string, string | string[] | undefined>;

export function keptParams(source: Source): URLSearchParams {
  const kept = new URLSearchParams();
  for (const key of KEPT_PARAMS) {
    const values = source instanceof URLSearchParams ? source.getAll(key) : [source[key] ?? []].flat();
    for (const value of values) if (value) kept.append(key, value.slice(0, 100));
  }
  return kept;
}

// "/search/<id>" with the kept params (and an extra one, such as a notice).
export function resultsHref(snapshotId: string, kept: URLSearchParams, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(kept);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const query = params.toString();
  return `/search/${snapshotId}${query ? `?${query}` : ""}`;
}

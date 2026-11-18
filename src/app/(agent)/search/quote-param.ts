// The quote a search adds to (plan 5b: "+ Add hotel" on a quote). It only preselects the quote in
// "Add to quote"; the add itself checks that the quote belongs to the agent's agency. Anything
// that is not a quote id is dropped.
export function quoteParam(value: FormDataEntryValue | string | string[] | null | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && /^[a-z0-9]{20,40}$/.test(v) ? v : null;
}

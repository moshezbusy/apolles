// The OAuth authorize parameters the consent form carries back to its actions (hidden fields).
// Anything else in the form, such as an agencyId, is never read.
export const AUTHORIZE_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

export function authorizeParamsFrom(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of AUTHORIZE_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string") out[key] = value.slice(0, 2000);
  }
  return out;
}

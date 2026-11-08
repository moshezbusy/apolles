// State of the "create agency" form. `created`: the agency exists (even if `error` is set,
// e.g. the email could not be sent), so the form must not be submitted again.
export type CreateAgencyState = { error?: string; created?: true } | null;

// The countries whose hotels and destinations are stored locally (plan 2b, decision 1; the
// spec's open question on database size). Staging's database is small (512 MB), so the full
// worldwide catalog is not stored. To change the list, the owner names countries in chat and
// this one line changes.
export const CONTENT_COUNTRIES: readonly string[] = [
  "GR", "CY", "IT", "FR", "ES", "PT", "GB", "DE", "NL", "AT", "CZ", "HU", "RO", "BG", "GE", "AE", "TH", "US",
];

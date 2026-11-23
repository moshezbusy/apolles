// A guest's given or family name as on a travel document: Latin letters (accents allowed),
// spaces, apostrophes, dots and hyphens, starting with a letter. Hebrew, Arabic or Cyrillic
// names are refused with a message to write them in Latin letters. Pure: the guest form checks
// it in the browser's message, the booking service on the server (service.ts).
export const GUEST_NAME_PATTERN = /^[\p{Script=Latin}][\p{Script=Latin}\p{M} '.-]*$/u;

export const GUEST_NAME_LATIN = "Use Latin letters (A to Z), as on the passport.";

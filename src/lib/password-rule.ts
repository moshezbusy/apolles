// The password rule, kept free of server-only imports so the set-password form can check it
// in the browser (to enable the button) with exactly the same code the server uses.

// Upper bound on any password we accept, so nobody can make the server hash megabytes.
export const PASSWORD_MAX_LENGTH = 256;

// Shown wherever a new password is chosen.
export const PASSWORD_RULE_COPY = "At least 8 characters, with letters and numbers.";
export const PASSWORDS_DIFFER_COPY = "The passwords do not match.";

// Phase-1 rule: at least 8 characters, at least one letter and one digit.
export function isValidPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /\p{L}/u.test(password) &&
    /\p{Nd}/u.test(password)
  );
}

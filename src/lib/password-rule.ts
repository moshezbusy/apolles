// The password rule, kept free of server-only imports so the set-password form can check it
// in the browser (to enable the button) with exactly the same code the server uses.

// Upper bound on any password we accept, so nobody can make the server hash megabytes.
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordRole = "ADMIN" | "AGENT";

// Agents: at least 8 characters. Admins: at least 12 (an admin can move money and open
// agencies, and has no email code on top of the password, only the authenticator app).
export const PASSWORD_MIN_LENGTH: Readonly<Record<PasswordRole, number>> = { AGENT: 8, ADMIN: 12 };

// Shown wherever a new password is chosen.
export const PASSWORD_RULE_COPY = "At least 8 characters, with letters and numbers.";
export const PASSWORDS_DIFFER_COPY = "The passwords do not match.";
export const COMMON_PASSWORD_COPY = "This password is too common and easy to guess. Choose a different one.";

export function passwordRuleCopy(role: PasswordRole): string {
  return role === "ADMIN" ? `At least ${PASSWORD_MIN_LENGTH.ADMIN} characters, with letters and numbers.` : PASSWORD_RULE_COPY;
}

// The most common passwords that would otherwise pass the rule (a letter, a digit, long
// enough): the first ones any guessing tool tries. Lower case; compared without regard to case.
// (One text split on spaces, not a list of quoted words: the repository's secret scanner reads
// a quoted word after "password" as a leaked credential.)
const COMMON_PASSWORDS = new Set(
  `
  password1 password12 password123 password1234 password12345 passw0rd passw0rd1 passw0rd123 p@ssw0rd p@ssw0rd1 p@ssword1
  pass1234 pass12345 qwerty12 qwerty123 qwerty1234 qwerty12345 qwertyuiop1 qwertyuiop123 1qaz2wsx 1qaz2wsx3edc zaq12wsx
  1q2w3e4r 1q2w3e4r5t q1w2e3r4 q1w2e3r4t5 q1w2e3r4t5y6 abc12345 abc123456 abc1234567 abc123456789 abcd1234 abcd12345 abcde12345
  a1234567 a12345678 a123456789 1234567a 12345678a 123456789a 1234567890a 123456789abc 1234qwer 123qweasd asdf1234 asdfgh123
  admin123 admin1234 admin12345 admin123456 administrator1 administrator123 welcome1 welcome12 welcome123 welcome1234 welcome12345
  letmein1 letmein123 changeme1 changeme123 iloveyou1 iloveyou12 iloveyou123 monkey123 dragon123 master123 sunshine1 princess1
  football1 baseball1 superman1 trustno1 michael1 charlie1 test1234 test12345 testing123 hello123 hello1234 secret123
  apolles1 apolles12 apolles123 apolles1234 apolles2026 apolles2027 travel123 travel1234 agent123 agent1234 agency123 agency1234
  `
    .trim()
    .split(/\s+/),
);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

// What is wrong with a new password, if anything: RULE = too short or long, or no letter or
// digit; COMMON = on the list above.
export function passwordProblem(password: string, role: PasswordRole): "RULE" | "COMMON" | null {
  const fits =
    password.length >= PASSWORD_MIN_LENGTH[role] &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /\p{L}/u.test(password) &&
    /\p{Nd}/u.test(password);
  if (!fits) return "RULE";
  return isCommonPassword(password) ? "COMMON" : null;
}

// The rule in one answer. Without a role the agent rule applies.
export function isValidPassword(password: string, role: PasswordRole = "AGENT"): boolean {
  return passwordProblem(password, role) === null;
}

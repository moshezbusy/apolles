import { hash, verify, type Algorithm } from "@node-rs/argon2";

// argon2id with the OWASP Password Storage Cheat Sheet minimum: 19 MiB memory, 2 passes,
// 1 lane. These are also the library defaults; they are written out so an upgrade of the
// library cannot silently weaken them. (Algorithm is a `const enum`; 2 = Argon2id.)
const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// A hash of a random value nobody knows, made with ARGON2_OPTIONS. login() verifies against
// it when the email is unknown (or has no password yet) so that case takes as long as a
// wrong password and does not reveal which emails have accounts.
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$t+gAU/4Z0EmI18XVVFR22g$nAO+1K631KNVt48TFnr3AneZhoyPLaA0KgVK78BU/14";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// Never throws: a malformed stored hash counts as a wrong password.
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// The rule itself lives in a browser-safe module so the forms can use the same check.
export { PASSWORD_MAX_LENGTH, PASSWORD_RULE_COPY, isValidPassword } from "@/lib/password-rule";

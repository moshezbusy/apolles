import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The admin's authenticator (TOTP) key at rest. With TOTP_ENCRYPTION_KEY set (32 random bytes
// as base64; required when APP_ENV=production, startup-check.ts) the key is stored encrypted
// with AES-256-GCM, so a copy of the database alone does not give working sign-in codes.
// Without the variable (development, tests) the key is stored as it is.
//
// Stored form: "enc:v1:" + base64url(12-byte nonce | 16-byte tag | ciphertext). The user id is
// bound in as associated data, so an encrypted key copied onto another user's row does not open.
// A stored value without the prefix is a plain key from before encryption was added: it still
// works, and is encrypted the next time its owner signs in with a right code (totp.ts).
// Keys and secrets are never logged.

const PREFIX = "enc:v1:";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// The encryption key, or null when the variable is not set. Throws when it is set but is not
// 32 bytes of base64: a wrong key must never be mistaken for "no key".
export function totpEncryptionKey(raw: string | undefined = process.env.TOTP_ENCRYPTION_KEY): Buffer | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(text) ? Buffer.from(text, "base64") : null;
  if (!key || key.length !== 32) throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes written as base64");
  return key;
}

export function isSealedTotpSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

// What to store for `secret`: encrypted when a key is configured, otherwise the secret itself.
export function sealTotpSecret(secret: string, userId: string): string {
  const key = totpEncryptionKey();
  if (!key) return secret;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

// The secret behind a stored value. A plain stored value is returned as it is. Throws when an
// encrypted value cannot be opened (no key, a different key, another user's row, damaged).
export function openTotpSecret(stored: string, userId: string): string {
  if (!isSealedTotpSecret(stored)) return stored;
  const key = totpEncryptionKey();
  if (!key) throw new Error("The TOTP secret is encrypted but TOTP_ENCRYPTION_KEY is not set");
  const packed = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (packed.length <= NONCE_BYTES + TAG_BYTES) throw new Error("The stored TOTP secret is damaged");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(packed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(packed.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}

import { createHash, randomBytes } from "node:crypto";

// Raw tokens (session cookies, set/reset links) are 32 random bytes as base64url
// = 43 characters. Anything far longer is junk and is rejected before any lookup.
export const MAX_RAW_TOKEN_LENGTH = 128;

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

// Only the SHA-256 of a token is stored. The token itself is high-entropy random data, so a
// plain fast hash is enough: a database leak does not give working cookies or links.
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

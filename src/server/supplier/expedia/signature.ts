import { createHash } from "node:crypto";

// Rapid Lodging signature authentication: the unsalted SHA-512 hex of API key + shared secret +
// UNIX timestamp in seconds. The timestamp in the header must be the one used in the hash.
export function authHeader(apiKey: string, sharedSecret: string, nowSeconds: number): string {
  const timestamp = String(Math.floor(nowSeconds));
  const signature = createHash("sha512").update(apiKey + sharedSecret + timestamp).digest("hex");
  return `EAN APIKey=${apiKey},Signature=${signature},timestamp=${timestamp}`;
}

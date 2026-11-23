import { afterEach, describe, expect, it, vi } from "vitest";
import { isSealedTotpSecret, openTotpSecret, sealTotpSecret, totpEncryptionKey } from "./totp-secret";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const SECRET = "JBSWY3DP".repeat(4); // base32, like a real authenticator key

describe("TOTP secret at rest", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("without a key (development, tests) the secret is stored and read as it is", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "");
    expect(totpEncryptionKey()).toBeNull();
    expect(sealTotpSecret(SECRET, "u1")).toBe(SECRET);
    expect(openTotpSecret(SECRET, "u1")).toBe(SECRET);
    expect(isSealedTotpSecret(SECRET)).toBe(false);
  });

  it("with a key the stored value is encrypted, different every time, and opens back to the secret", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", KEY);
    const a = sealTotpSecret(SECRET, "u1");
    const b = sealTotpSecret(SECRET, "u1");
    expect(a).toMatch(/^enc:v1:[A-Za-z0-9_-]+$/);
    expect(a).not.toContain(SECRET);
    expect(a).not.toBe(b);
    expect(isSealedTotpSecret(a)).toBe(true);
    expect(openTotpSecret(a, "u1")).toBe(SECRET);
    expect(openTotpSecret(b, "u1")).toBe(SECRET);
  });

  it("a plain secret stored before encryption was added still reads with a key set", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", KEY);
    expect(openTotpSecret(SECRET, "u1")).toBe(SECRET);
  });

  it("does not open with another key, on another user's row, without the key, or when changed", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", KEY);
    const sealed = sealTotpSecret(SECRET, "u1");
    expect(() => openTotpSecret(sealed, "u2")).toThrow();
    expect(() => openTotpSecret(`${sealed.slice(0, -2)}AA`, "u1")).toThrow();
    expect(() => openTotpSecret("enc:v1:AAAA", "u1")).toThrow();
    vi.stubEnv("TOTP_ENCRYPTION_KEY", OTHER_KEY);
    expect(() => openTotpSecret(sealed, "u1")).toThrow();
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "");
    expect(() => openTotpSecret(sealed, "u1")).toThrow(/TOTP_ENCRYPTION_KEY is not set/);
  });

  it("a key of the wrong size or shape is an error, never treated as no key; the message holds no key", () => {
    for (const bad of ["short", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), "not base64 at all!!"]) {
      vi.stubEnv("TOTP_ENCRYPTION_KEY", bad);
      expect(() => totpEncryptionKey(), bad).toThrow("TOTP_ENCRYPTION_KEY must be 32 bytes written as base64");
      expect(() => sealTotpSecret(SECRET, "u1")).toThrow();
    }
  });
});

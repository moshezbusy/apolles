import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isValidPassword,
  verifyPassword,
} from "@/server/auth/password";

describe("isValidPassword", () => {
  it("isValidPassword: 'abcdefg1' true, 'abcdefgh' false, 'abc1' false", () => {
    expect(isValidPassword("abcdefg1")).toBe(true);
    expect(isValidPassword("abcdefgh")).toBe(false);
    expect(isValidPassword("abc1")).toBe(false);
  });

  it("requires at least one letter", () => {
    expect(isValidPassword("12345678")).toBe(false);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hashes with argon2id (OWASP parameters) and never returns the plain password", async () => {
    const hash = await hashPassword("abcdefg1");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("abcdefg1");
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("abcdefg1");
    expect(await verifyPassword(hash, "abcdefg1")).toBe(true);
    expect(await verifyPassword(hash, "abcdefg2")).toBe(false);
  });

  it("returns false (does not throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "abcdefg1")).toBe(false);
  });

  it("dummy hash uses the same parameters as real hashes (timing parity)", async () => {
    const params = (h: string) => h.split("$").slice(1, 4).join("$");
    expect(params(DUMMY_PASSWORD_HASH)).toBe(params(await hashPassword("abcdefg1")));
  });
});

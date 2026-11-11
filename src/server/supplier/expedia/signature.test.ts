import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authHeader } from "./signature";

describe("authHeader", () => {
  it("is 'EAN APIKey=…,Signature=sha512(key+secret+ts),timestamp=ts' with the same timestamp in both", () => {
    const expected = createHash("sha512").update("my-key" + "my-secret" + "1700000000").digest("hex");
    expect(authHeader("my-key", "my-secret", 1700000000)).toBe(
      `EAN APIKey=my-key,Signature=${expected},timestamp=1700000000`,
    );
  });

  it("uses whole UNIX seconds and never contains the secret", () => {
    const header = authHeader("k", "super-secret-value", 1700000000.9);
    expect(header).toMatch(/timestamp=1700000000$/);
    expect(header).not.toContain("super-secret-value");
  });
});

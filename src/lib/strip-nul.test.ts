import { describe, expect, it } from "vitest";
import { stripNul } from "./strip-nul";

describe("stripNul", () => {
  it("removes NUL from strings at any depth, keys included, and keeps other values", () => {
    expect(stripNul({ "a\u0000": ["x\u0000y", 1, null, true, { b: "c\u0000" }] })).toEqual({ a: ["xy", 1, null, true, { b: "c" }] });
  });
});

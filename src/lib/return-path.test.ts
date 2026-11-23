import { describe, expect, it } from "vitest";
import { afterSignInPath, safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeReturnPath("/bookings")).toBe("/bookings");
    expect(safeReturnPath("/bookings?status=CONFIRMED&page=2")).toBe("/bookings?status=CONFIRMED&page=2");
    expect(safeReturnPath("/book/abc123")).toBe("/book/abc123");
  });

  it("refuses anything that could lead to another site", () => {
    for (const raw of ["evil.example", " /bookings", "/book ings", ""]) expect(safeReturnPath(raw), raw).toBeNull();
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example/x")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("/a\tb")).toBeNull();
    expect(safeReturnPath("/a\nb")).toBeNull();
  });

  it("refuses the sign-in pages themselves, other types and very long values", () => {
    expect(safeReturnPath("/login")).toBeNull();
    expect(safeReturnPath("/login/verify")).toBeNull();
    expect(safeReturnPath("/logout")).toBeNull();
    expect(safeReturnPath(["/bookings"])).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(`/${"a".repeat(600)}`)).toBeNull();
    expect(safeReturnPath("/loginx")).toBe("/loginx");
  });

  it("afterSignInPath falls back to the search page", () => {
    expect(afterSignInPath("//evil.example")).toBe("/search");
    expect(afterSignInPath(undefined)).toBe("/search");
    expect(afterSignInPath("/clients")).toBe("/clients");
  });
});

import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/server/auth/return-to";

describe("safeReturnTo", () => {
  it("refuses anything that could leave the site or is not a return page", () => {
    for (const raw of [
      "https://evil.com",
      "//evil.com",
      "/search",
      "/\\evil.com",
      "/oauth/authorize",
      "/oauth/authorize?a=1//evil.com",
      "/oauth/authorize?a=\\b",
      "/oauth/authorizeX?a=1",
      "/search/openX?hotel=1",
      "/oauth/authorize?a=1\r\nSet-Cookie:x",
      "/oauth/authorize?a=b c",
      `/oauth/authorize?${"a".repeat(2000)}`,
      "",
      null,
      undefined,
      42,
      ["/oauth/authorize?client_id=x"],
    ]) {
      expect(safeReturnTo(raw), String(raw)).toBeNull();
    }
  });

  it("keeps the authorize request and result links as they are", () => {
    expect(safeReturnTo("/oauth/authorize?client_id=x")).toBe("/oauth/authorize?client_id=x");
    expect(safeReturnTo("/search/open?hotel=1")).toBe("/search/open?hotel=1");
    const encoded = `/oauth/authorize?redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}`;
    expect(safeReturnTo(encoded)).toBe(encoded);
    const longest = `/search/open?${"a".repeat(2000 - "/search/open?".length)}`;
    expect(safeReturnTo(longest)).toBe(longest);
  });
});

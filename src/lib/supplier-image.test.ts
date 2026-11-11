import { describe, expect, it } from "vitest";
import { safeImageUrl } from "./supplier-image";

describe("safeImageUrl", () => {
  it("keeps an https image from the supplier's image host", () => {
    expect(safeImageUrl("https://i.travelapi.com/lodging/1/a_z.jpg")).toBe("https://i.travelapi.com/lodging/1/a_z.jpg");
  });

  it.each([
    "http://i.travelapi.com/a.jpg",
    "https://evil.example/a.jpg",
    "https://i.travelapi.com.evil.example/a.jpg",
    "https://user@i.travelapi.com/a.jpg",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("drops %s", (url) => {
    expect(safeImageUrl(url)).toBeNull();
  });
});

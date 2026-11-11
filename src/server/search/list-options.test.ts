import { describe, expect, it } from "vitest";
import { minorToUsdText, parseListOptions, usdToMinor } from "./list-options";

describe("parseListOptions (results page URL → list options)", () => {
  it("reads every filter; prices in USD become cents with integer math", () => {
    expect(
      parseListOptions({ sort: "price_asc", name: " Hilton ", room: "king", min: "100", max: "250.50", stars: ["4", "5"], free: "1", cursor: "20" }),
    ).toEqual({ sort: "price_asc", name: "Hilton", roomName: "king", minPriceMinor: 10_000, maxPriceMinor: 25_050, stars: [4, 5], freeCancellation: true, cursor: "20" });
  });

  it("a single star value is read as a list", () => {
    expect(parseListOptions({ stars: "3" }).stars).toEqual([3]);
  });

  it("anything unreadable falls back to the default, never an error", () => {
    expect(parseListOptions({ sort: "nonsense", min: "-5", max: "1e9", stars: ["9", "x"], cursor: "abc", free: "yes", name: "x".repeat(500) })).toEqual({
      sort: "recommended",
      name: "x".repeat(100),
    });
  });

  it("no params → recommended, nothing else", () => {
    expect(parseListOptions({})).toEqual({ sort: "recommended" });
  });
});

describe("minorToUsdText", () => {
  it.each([
    [25_050, "250.5"],
    [10_000, "100"],
    [1, "0.01"],
    [12_345, "123.45"],
  ])("%i → %s, and reads back to the same cents", (minor, text) => {
    expect(minorToUsdText(minor)).toBe(text);
    expect(usdToMinor(text)).toBe(minor);
  });
});

import { describe, expect, it } from "vitest";
import { keptParams, resultsHref } from "./kept-params";

describe("kept params of the results page", () => {
  it("keeps the filters, sort, page and quote; drops everything else", () => {
    const kept = keptParams({ sort: "price_asc", name: "Ritz", stars: ["5", "4"], free: "1", cursor: "40", quote: "q".repeat(25), notice: "unavailable", evil: "x" });
    expect(kept.toString()).toBe(`sort=price_asc&name=Ritz&stars=5&stars=4&free=1&cursor=40&quote=${"q".repeat(25)}`);
  });

  it("reads a query string the same way, and cuts long values", () => {
    const kept = keptParams(new URLSearchParams(`room=${"k".repeat(300)}&min=100&max=&x=1&stars=3&stars=2`));
    expect(kept.get("room")).toHaveLength(100);
    expect(kept.get("min")).toBe("100");
    expect(kept.has("max")).toBe(false);
    expect(kept.has("x")).toBe(false);
    expect(kept.getAll("stars")).toEqual(["3", "2"]);
  });

  it("builds the results link, with or without params", () => {
    expect(resultsHref("abc", new URLSearchParams())).toBe("/search/abc");
    expect(resultsHref("abc", keptParams({ sort: "price_desc" }), { notice: "limited" })).toBe("/search/abc?sort=price_desc&notice=limited");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Screen 01: the public homepage (plan 7). No prices, no hotels and no supplier brand: hotel
// search is for signed-in, verified agents only.
describe("home page", () => {
  it("explains Apolles to travel agents and links to Join and Agent Login", async () => {
    const { default: Home } = await import("./page");
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toContain("Hotel booking, built for travel agents");
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>Join as a Travel Agent<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/login"[^>]*>Agent Login<\/a>/);
    for (const section of ["How it works", "Send options. Let your client choose.", "Who can join Apolles?"]) expect(html).toContain(section);
    expect(html).not.toMatch(/expedia/i);
  });
});

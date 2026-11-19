import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FiltersPanel } from "./filters-panel";

describe("FiltersPanel (plan 9: results filters fold away on a phone)", () => {
  const html = renderToStaticMarkup(
    <FiltersPanel activeCount={2}>
      <form id="the-form" />
    </FiltersPanel>,
  );

  it("shows a Filters button for phones (hidden from lg up), closed at first, with the number of active filters", () => {
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>/);
    expect(html).toMatch(/<button[^>]*class="[^"]*lg:hidden/);
    expect(html).toMatch(/Filters[\s\S]*?2/);
  });

  it("keeps the form in the page, hidden below lg and always shown from lg up", () => {
    expect(html).toMatch(/<div[^>]*id="[^"]+"[^>]*class="hidden lg:block[^"]*"[^>]*><form id="the-form">|<div[^>]*class="hidden lg:block[^"]*"[^>]*id="[^"]+"[^>]*><form id="the-form">/);
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controls && html.includes(`id="${controls}"`)).toBe(true);
  });

  it("says nothing about active filters when there are none", () => {
    expect(renderToStaticMarkup(<FiltersPanel activeCount={0}><p /></FiltersPanel>)).not.toMatch(/Filters\s*·/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchForm, ageText } from "./search-form";
import type { SearchFormValues } from "./form-state";

const values: SearchFormValues = {
  destinationId: "paris",
  destinationLabel: "Paris, France",
  checkin: "2026-12-03",
  checkout: "2026-12-05",
  adults: "2",
  childCount: "2",
  childAges: ["4", "0"],
};

function render(v: SearchFormValues = values): string {
  return renderToStaticMarkup(<SearchForm action={async () => null} values={v} minDate="2026-11-19" maxDate="2027-11-19" />);
}

describe("search form (plan 9)", () => {
  const html = render();

  it("dates show as day/month/year and are sent as ISO", () => {
    expect(html).toContain("03/12/2026");
    expect(html).toContain("05/12/2026");
    expect(html).toContain('<input type="hidden" name="checkin" value="2026-12-03"/>');
    expect(html).toContain('<input type="hidden" name="checkout" value="2026-12-05"/>');
    expect(html).not.toContain('type="date"');
  });

  it("children are added straight by age: an 'Add a child' button opens the list of ages, no number-of-children box", () => {
    expect(html).toMatch(/<button type="button" aria-expanded="false"[^>]*>Add a child/);
    expect(html).not.toMatch(/<select[^>]*name="childCount"/);
    expect(html).not.toMatch(/<select[^>]*aria-label="Add a child"/); // arrow keys on a closed select would add children
  });

  it("names the ages as in the owner's picture", () => {
    expect(ageText("0")).toBe("0 years");
    expect(ageText("1")).toBe("1 year");
    expect(ageText("17")).toBe("17 years");
  });

  it("each child is a chip with its age and a remove button, and is sent as childAge", () => {
    expect(html).toContain("Child 1 · 4 years");
    expect(html).toContain("Child 2 · 0 years");
    expect(html).toMatch(/<button[^>]*aria-label="Remove child 1"/);
    expect(html).toContain('<input type="hidden" name="childCount" value="2"/>');
    expect([...html.matchAll(/<input type="hidden" name="childAge" value="(\d+)"\/>/g)].map((m) => m[1])).toEqual(["4", "0"]);
  });

  it("hides 'Add a child' at six children (the search limit)", () => {
    const six = render({ ...values, childCount: "6", childAges: ["1", "2", "3", "4", "5", "6"] });
    expect(six).not.toContain(">Add a child");
    expect(six).toContain("Up to 6 children.");
  });

  it("the rooms and guests dropdown closes on a tap outside (data-menu)", () => {
    expect(html).toMatch(/<details[^>]*data-menu="plain"/);
  });
});

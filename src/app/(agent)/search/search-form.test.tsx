import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchForm, ageText } from "./search-form";
import { childAgesComplete, readSearchForm, toSearchInput, type SearchFormValues } from "./form-state";
import { stayText } from "./parts";
import { searchInputSchema } from "@/server/search/input";

const values: SearchFormValues = {
  destinationId: "paris",
  destinationLabel: "Paris, France",
  checkin: "2026-12-03",
  checkout: "2026-12-05",
  rooms: [{ adults: "2", childAges: ["4", "0"] }],
};

function render(v: SearchFormValues = values, multiRoomAllowed = false): string {
  return renderToStaticMarkup(<SearchForm action={async () => null} values={v} minDate="2026-11-19" maxDate="2027-11-19" multiRoomAllowed={multiRoomAllowed} />);
}

// The values of the hidden inputs with this name, in page order (one fixed pattern: no regex
// built from a string).
const hidden = (html: string, name: string) =>
  [...html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"\/>/g)].filter((m) => m[1] === name).map((m) => m[2]);

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
    expect(html).not.toMatch(/name="childCount"/);
    expect(html).not.toMatch(/<select[^>]*aria-label="Add a child"/); // arrow keys on a closed select would add children
  });

  it("names the ages as in the owner's picture", () => {
    expect(ageText("0")).toBe("0 years");
    expect(ageText("1")).toBe("1 year");
    expect(ageText("17")).toBe("17 years");
  });

  it("each child is a chip with its age and a remove button; the room is sent as room_adults and room_children", () => {
    expect(html).toContain("Child 1 · 4 years");
    expect(html).toContain("Child 2 · 0 years");
    expect(html).toMatch(/<button[^>]*aria-label="Remove child 1"/);
    expect(hidden(html, "room_adults")).toEqual(["2"]);
    expect(hidden(html, "room_children")).toEqual(["4,0"]);
    expect(html).not.toMatch(/name="childAge"/);
  });

  it("hides 'Add a child' at six children (the search limit)", () => {
    const six = render({ ...values, rooms: [{ adults: "2", childAges: ["1", "2", "3", "4", "5", "6"] }] });
    expect(six).not.toContain(">Add a child");
    expect(six).toContain("Up to 6 children.");
  });

  it("the rooms and guests dropdown closes on a tap outside (data-menu)", () => {
    expect(html).toMatch(/<details[^>]*data-menu="plain"/);
  });
});

describe("search form: rooms (plan 10)", () => {
  const two: SearchFormValues = { ...values, rooms: [{ adults: "2", childAges: ["9"] }, { adults: "1", childAges: [] }] };

  it("one block per room, each with its Adults and children, sent in room order", () => {
    const html = render(two, true);
    expect(html).toContain("Room 1");
    expect(html).toContain("Room 2");
    expect(hidden(html, "room_adults")).toEqual(["2", "1"]);
    expect(hidden(html, "room_children")).toEqual(["9", ""]);
    expect(html).toContain("2 rooms · 4 guests");
    expect(html).toContain("Same room type for all rooms.");
  });

  it("'Remove room' from room 2 on; 'Add room' only when several rooms are allowed, up to 8", () => {
    const html = render(two, true);
    expect(html).toMatch(/<button[^>]*aria-label="Remove room 2"/);
    expect(html).not.toMatch(/aria-label="Remove room 1"/);
    expect(html).toMatch(/<button type="button"[^>]*>Add room</);
    expect(render(values, false)).not.toContain(">Add room<");
    expect(render(values, false)).toContain("1 room · 4 guests");
    expect(render(values, false)).not.toContain("Same room type for all rooms.");
    const eight = render({ ...values, rooms: Array.from({ length: 8 }, () => ({ adults: "1", childAges: [] })) }, true);
    expect(eight).not.toContain(">Add room<");
    expect(hidden(eight, "room_adults")).toHaveLength(8);
  });

  it("with no rooms (a refused post), the form shows one room of two adults", () => {
    const html = render({ ...values, rooms: [] });
    expect(hidden(html, "room_adults")).toEqual(["2"]);
    expect(hidden(html, "room_children")).toEqual([""]);
  });
});

describe("reading the search form (plan 10)", () => {
  const form = (fields: [string, string][]) => {
    const data = new FormData();
    for (const [k, v] of fields) data.append(k, v);
    return data;
  };

  it("pairs room_adults and room_children by room, in order", () => {
    const values = readSearchForm(form([["destinationId", "paris"], ["room_adults", "2"], ["room_children", "9,4"], ["room_adults", "1"], ["room_children", ""]]));
    expect(values.rooms).toEqual([{ adults: "2", childAges: ["9", "4"] }, { adults: "1", childAges: [] }]);
    expect(toSearchInput(values).rooms).toEqual([{ adults: 2, childAges: [9, 4] }, { adults: 1, childAges: [] }]);
    expect(childAgesComplete(values)).toBe(true);
  });

  it("reads one room more than the 8 allowed, so 9 rooms are refused, not cut; a child without an age is incomplete; a bad number is never a silent 0", () => {
    const many = readSearchForm(form([["destinationId", "paris"], ["checkin", "2027-04-10"], ["checkout", "2027-04-12"], ...Array.from({ length: 10 }, (): [string, string] => ["room_adults", "1"])]));
    expect(many.rooms).toHaveLength(9);
    expect(searchInputSchema(new Date("2027-03-01T10:00:00Z")).safeParse(toSearchInput(many)).success).toBe(false);
    const eight = readSearchForm(form([["destinationId", "paris"], ["checkin", "2027-04-10"], ["checkout", "2027-04-12"], ...Array.from({ length: 8 }, (): [string, string] => ["room_adults", "1"])]));
    expect(searchInputSchema(new Date("2027-03-01T10:00:00Z")).safeParse(toSearchInput(eight)).success).toBe(true);
    expect(childAgesComplete(readSearchForm(form([["room_adults", "2"], ["room_children", "4,"]])))).toBe(false);
    expect(toSearchInput(readSearchForm(form([["room_adults", "two"], ["room_children", "x"]]))).rooms[0]).toEqual({ adults: Number.NaN, childAges: [Number.NaN] });
  });
});

describe("stayText (plan 10)", () => {
  it("one room reads as before; several rooms name the rooms and the totals", () => {
    expect(stayText({ nights: 3, rooms: [{ adults: 2, childAges: [] }] })).toBe("3 nights, 2 adults");
    expect(stayText({ nights: 1, rooms: [{ adults: 1, childAges: [5] }] })).toBe("1 night, 1 adult, 1 child");
    expect(stayText({ nights: 3, rooms: [{ adults: 2, childAges: [7] }, { adults: 2, childAges: [] }] })).toBe("3 nights, 2 rooms, 4 adults, 1 child");
  });
});

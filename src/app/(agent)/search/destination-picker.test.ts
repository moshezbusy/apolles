import { describe, expect, it } from "vitest";
import { DESTINATION_PLACEHOLDER, TOO_MANY_TEXT, choiceDetail, choicesOf, enterChoice, noMatchText, type Choice } from "./destination-picker";

const rome: Choice = { kind: "destination", id: "rome", label: "Rome, Lazio, Italy", type: "city" };
const roma: Choice = { kind: "destination", id: "roma-area", label: "Roma Nord, Italy", type: "multi_city_vicinity" };
const hassler: Choice = { kind: "hotel", id: "h1", label: "Hotel Hassler Roma", place: "Rome, Italy" };

describe("destination picker", () => {
  it("Enter with the list open and nothing highlighted picks the first destination (typing 'Rome' + Enter is Rome)", () => {
    expect(enterChoice([rome, roma, hassler], -1)).toBe(rome);
  });

  it("Enter picks the highlighted destination or hotel", () => {
    expect(enterChoice([rome, roma, hassler], 1)).toBe(roma);
    expect(enterChoice([rome, roma, hassler], 2)).toBe(hassler);
  });

  it("Enter with no destinations picks nothing", () => {
    expect(enterChoice([], -1)).toBeNull();
  });

  it("the server's answer is one list, destinations first, then hotels; anything malformed is left out", () => {
    const body = {
      destinations: [{ id: "rome", label: "Rome, Lazio, Italy", type: "city" }, { id: 7, label: "Bad" }],
      hotels: [{ id: "h1", name: "Hotel Hassler Roma", place: "Rome, Italy" }, { id: "h2" }],
    };
    expect(choicesOf(body as never)).toEqual([rome, hassler]);
    expect(choicesOf({})).toEqual([]);
    expect(choicesOf({ destinations: "x", hotels: null } as never)).toEqual([]);
  });

  it("each choice says what it is: a city, an area, or a hotel with its city and country", () => {
    expect([rome, roma, hassler].map(choiceDetail)).toEqual(["City", "Area", "Hotel · Rome, Italy"]);
    expect(choiceDetail({ ...hassler, place: "" })).toBe("Hotel");
  });

  it("the box and its no-match text say it finds cities, areas and hotels (screen 07)", () => {
    expect(DESTINATION_PLACEHOLDER).toBe("City, hotel or location");
    expect(noMatchText("pariss")).toBe('No city, area or hotel matches "pariss". Check the spelling, or type the city the hotel is in.');
  });

  it("too many requests: a message that says what to do, never an empty list", () => {
    expect(TOO_MANY_TEXT).toBe("Too many searches. Wait a moment, then type again.");
  });
});

import { describe, expect, it } from "vitest";
import { DESTINATION_PLACEHOLDER, TOO_MANY_TEXT, enterChoice, noMatchText } from "./destination-picker";

const rome = { id: "rome", label: "Rome, Lazio, Italy", type: "city" };
const roma = { id: "roma-area", label: "Roma Nord, Italy", type: "area" };

describe("destination picker", () => {
  it("Enter with the list open and nothing highlighted picks the first destination (typing 'Rome' + Enter is Rome)", () => {
    expect(enterChoice([rome, roma], -1)).toBe(rome);
  });

  it("Enter picks the highlighted destination", () => {
    expect(enterChoice([rome, roma], 1)).toBe(roma);
  });

  it("Enter with no destinations picks nothing", () => {
    expect(enterChoice([], -1)).toBeNull();
  });

  it("no match: says so, with the typed text, and that the search finds cities and areas, not hotel names", () => {
    expect(noMatchText("pariss")).toBe('No city or area matches "pariss". Check the spelling, or type the city the hotel is in: hotel names are not searched.');
    expect(DESTINATION_PLACEHOLDER).toBe("City or area, for example Paris");
  });

  it("too many requests: a message that says what to do, never an empty list", () => {
    expect(TOO_MANY_TEXT).toBe("Too many searches. Wait a moment, then type again.");
  });
});

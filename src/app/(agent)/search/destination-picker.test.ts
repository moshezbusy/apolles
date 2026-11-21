import { describe, expect, it } from "vitest";
import { enterChoice, noMatchText } from "./destination-picker";

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

  it("no match: says so, with the typed text", () => {
    expect(noMatchText("pariss")).toBe('No destination matches "pariss". Check the spelling.');
  });
});

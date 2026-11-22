import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hotelLink, parseRoomsParam } from "@/server/ai/links";

beforeEach(() => vi.stubEnv("APP_URL", "https://app.example.test/"));
afterEach(() => vi.unstubAllEnvs());

const base = {
  hotelName: "Hyatt Ziva Cancun",
  propertyId: "12345",
  destinationId: "6023",
  checkin: "2026-10-28",
  checkout: "2026-11-04",
  rooms: [{ adults: 2, childAges: [5] }, { adults: 2, childAges: [] }],
  nationality: "IL",
};

describe("hotelLink", () => {
  it("builds the /search/open link of design §6 on the app's own address", () => {
    const url = new URL(hotelLink(base));
    expect(url.origin + url.pathname).toBe("https://app.example.test/search/open");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dest: "Hyatt Ziva Cancun",
      type: "hotel",
      in: "2026-10-28",
      out: "2026-11-04",
      rooms: "2-5,2",
      nat: "Israel",
      hotel: "12345",
      destId: "6023",
    });
  });

  it("round-trips the rooms through parseRoomsParam", () => {
    const rooms = [{ adults: 1, childAges: [0, 17, 9] }, { adults: 8, childAges: [] }, { adults: 2, childAges: [4, 4, 4, 4, 4, 4] }];
    const url = new URL(hotelLink({ ...base, rooms }));
    expect(parseRoomsParam(url.searchParams.get("rooms") ?? "")).toEqual(rooms);
  });

  it("encodes text that would otherwise break the link", () => {
    const url = new URL(hotelLink({ ...base, hotelName: "Bed & Breakfast #1 ?x=y" }));
    expect(url.searchParams.get("dest")).toBe("Bed & Breakfast #1 ?x=y");
    expect(url.searchParams.get("type")).toBe("hotel");
  });

  it("refuses a nationality that is not an ISO country code", () => {
    expect(() => hotelLink({ ...base, nationality: "Israel" })).toThrow();
  });
});

describe("parseRoomsParam", () => {
  it('"2-5-9,2" → two rooms', () => {
    expect(parseRoomsParam("2-5-9,2")).toEqual([
      { adults: 2, childAges: [5, 9] },
      { adults: 2, childAges: [] },
    ]);
  });

  it.each([
    ["9"], // 9 adults
    ["0"], // no adult
    ["2-18"], // child of 18
    ["2,,2"], // empty room
    ["2,2,2,2,2,2,2,2,2"], // 9 rooms
    ["2-1-1-1-1-1-1-1"], // 7 children
    [""],
    ["2-"],
    ["-2"],
    ["2.5"],
    ["2 -5"],
    ["a"],
    ["2-05"],
    ["1".repeat(300)],
  ])("%j → null", (text) => {
    expect(parseRoomsParam(text)).toBeNull();
  });
});

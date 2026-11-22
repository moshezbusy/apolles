import { describe, expect, it, vi } from "vitest";
import type { ApiAnswer } from "./apolles-client";
import { RpcError } from "./protocol";
import { callTool, listTools, TOOL_NAMES, type CallApi } from "./tools";

// The two tools: their descriptions, argument checks, and how API answers become tool results.

const LINK = "https://app.example.test/search/open?dest=Hotel+1&type=hotel&in=2027-04-10&out=2027-04-12&rooms=2&nat=Israel&hotel=1&destId=paris";

// The same shapes the internal API answers (src/server/ai/search-api.test.ts).
const SEARCH_OK = {
  search_id: "snap_123",
  destination: { destination_id: "paris", name: "Paris, France" },
  nights: 2,
  total_hotels: 3,
  hotels: [
    {
      hotel_id: "1",
      name: "Hotel 1",
      city: "Paris",
      stars: 4.5,
      cheapest_total: { amount: "1234.56", currency: "USD" },
      free_cancellation_available: true,
      fees_at_hotel: true,
      other_rates: 1,
      link: LINK,
    },
    {
      hotel_id: "3",
      name: "Hotel 3",
      city: "Paris",
      stars: null,
      cheapest_total: { amount: "200.03", currency: "USD" },
      free_cancellation_available: false,
      fees_at_hotel: false,
      other_rates: 0,
      link: LINK,
    },
  ],
  notes: ["Prices are checked again before booking. Book in Apolles.", "Nationality does not change the price; the agency's country is used."],
};

const CANDIDATES = {
  candidates: [
    { destination_id: "sj-us", name: "San Jose, California, United States", type: "city" },
    { destination_id: "sj-cr", name: "San Jose, Costa Rica", type: "city" },
  ],
  message: "Several places match. Call again with destination_id.",
};

const RATES_OK = {
  search_id: "snap_123",
  hotel: { hotel_id: "1", name: "Hotel 1", city: "Paris", stars: 4.5 },
  stay: { checkin: "2027-04-10", checkout: "2027-04-12", nights: 2, rooms: [{ adults: 2, child_ages: [] }] },
  rates: [
    {
      room_name: "Double Room",
      bed_types: ["1 King Bed", "2 Queen Beds"],
      bed_type_note: "Bed type is a request and not guaranteed",
      refundable: false,
      free_cancellation_until: null,
      total: { amount: "123.45", currency: "USD" },
      taxes_and_fees: { amount: "15.50", currency: "USD" },
      fees_at_hotel: [{ kind: "resort_fee", amount: { amount: "40.00", currency: "USD" }, local_amount: { amount: "37.00", currency: "EUR" } }],
      amenities: ["Free WiFi", "Breakfast"],
    },
    {
      room_name: "Double Room",
      bed_types: ["1 King Bed"],
      bed_type_note: "Bed type is a request and not guaranteed",
      refundable: true,
      free_cancellation_until: "2027-04-07T00:00:00.000+02:00",
      total: { amount: "12300.00", currency: "USD" },
      taxes_and_fees: null,
      fees_at_hotel: [],
      amenities: [],
    },
  ],
  link: LINK,
};

const SEARCH_ARGS = { destination_id: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, child_ages: [] }], nationality: "IL" };
const RATES_ARGS = { search_id: "snap_123", hotel_id: "1" };

const answer = (status: number, json: unknown): ApiAnswer => ({ kind: "answer", status, json });
const api = (a: ApiAnswer) => vi.fn<CallApi>(async () => a);
const textOf = (r: { content: { type: string; text: string }[] }) => r.content.map((c) => c.text).join("\n");

async function invalidParams(name: unknown, args: unknown, spy = api(answer(200, SEARCH_OK))) {
  const error = await callTool(name, args, spy).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RpcError);
  expect(error).toMatchObject({ code: -32602, message: "Invalid params" });
  expect(spy).not.toHaveBeenCalled();
}

describe("tools/list", () => {
  it("exactly get_hotel_rates and search_hotels, sorted, read-only annotations, strict object schemas", () => {
    const tools = listTools();
    expect(tools.map((t) => t.name)).toEqual(["get_hotel_rates", "search_hotels"]);
    expect([...TOOL_NAMES]).toEqual(["get_hotel_rates", "search_hotels"]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(80);
    }
    const search = tools.find((t) => t.name === "search_hotels")!;
    expect(search.inputSchema.required).toEqual(expect.arrayContaining(["checkin", "checkout", "rooms", "nationality"]));
    expect(Object.keys(search.inputSchema.properties as object).sort()).toEqual(
      ["checkin", "checkout", "destination", "destination_id", "free_cancellation_only", "max_results", "min_stars", "nationality", "rooms", "sort"].sort(),
    );
    expect(search.description).toMatch(/cannot book/i);
    const rates = tools.find((t) => t.name === "get_hotel_rates")!;
    expect(Object.keys(rates.inputSchema.properties as object).sort()).toEqual(["hotel_id", "nationality", "search_id"]);
    expect(rates.description).toMatch(/search_hotels/);
  });

  it("no booking tool exists", async () => {
    for (const tool of listTools()) expect(tool.name).not.toMatch(/book|cancel|voucher|balance|wallet|client|guest/i);
    await invalidParams("book_hotel", {});
    await invalidParams("cancel_booking", {});
    await invalidParams(undefined, {});
  });
});

describe("arguments", () => {
  it("an unknown field, a bad type, a missing field or both destination fields → -32602, no API call", async () => {
    await invalidParams("search_hotels", { ...SEARCH_ARGS, price: 1 });
    await invalidParams("search_hotels", { ...SEARCH_ARGS, rooms: [{ adults: 2, child_ages: [], extra: 1 }] });
    await invalidParams("search_hotels", { ...SEARCH_ARGS, rooms: [{ adults: 9, child_ages: [] }] });
    await invalidParams("search_hotels", { ...SEARCH_ARGS, nationality: "il" });
    await invalidParams("search_hotels", { ...SEARCH_ARGS, checkin: "10/04/2027" });
    await invalidParams("search_hotels", { ...SEARCH_ARGS, destination: "Paris" });
    const noDestination = Object.fromEntries(Object.entries(SEARCH_ARGS).filter(([key]) => key !== "destination_id"));
    await invalidParams("search_hotels", noDestination);
    await invalidParams("search_hotels", { ...SEARCH_ARGS, max_results: 21 });
    await invalidParams("get_hotel_rates", { ...RATES_ARGS, rate_id: "x" });
    await invalidParams("get_hotel_rates", { search_id: "snap_123" });
    await invalidParams("get_hotel_rates", "not an object");
  });

  it("the validated arguments are the API body", async () => {
    const spy = api(answer(200, SEARCH_OK));
    const args = { ...SEARCH_ARGS, max_results: 5, sort: "price_asc", min_stars: 3, free_cancellation_only: true };
    await callTool("search_hotels", args, spy);
    expect(spy).toHaveBeenCalledWith("search", args);
    const rates = api(answer(200, RATES_OK));
    await callTool("get_hotel_rates", { ...RATES_ARGS, nationality: "FR" }, rates);
    expect(rates).toHaveBeenCalledWith("rates", { ...RATES_ARGS, nationality: "FR" });
  });

  it("the error data names the field, not the value sent", async () => {
    const error = (await callTool("search_hotels", { ...SEARCH_ARGS, nationality: "secret-value" }, api(answer(200, SEARCH_OK))).catch((e: unknown) => e)) as RpcError;
    expect(JSON.stringify(error.data)).toContain("nationality");
    expect(JSON.stringify(error.data)).not.toContain("secret-value");
  });
});

describe("search_hotels results", () => {
  it("a summary line per hotel plus the API answer as structuredContent", async () => {
    const result = await callTool("search_hotels", SEARCH_ARGS, api(answer(200, SEARCH_OK)));
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(SEARCH_OK);
    const text = textOf(result);
    expect(text).toContain("Paris, France");
    expect(text).toContain("2 nights");
    expect(text).toContain(`Hotel 1 (4.5★, Paris) — from USD 1,234.56 total · free cancellation available · ${LINK}`);
    expect(text).toContain(`Hotel 3 (Paris) — from USD 200.03 total · ${LINK}`);
    expect(text).toContain("snap_123");
    expect(text).toContain("hotel_id 1");
    expect(text).toContain("Prices are checked again before booking. Book in Apolles.");
  });

  it("no hotels → says so", async () => {
    const result = await callTool("search_hotels", SEARCH_ARGS, api(answer(200, { ...SEARCH_OK, total_hotels: 0, hotels: [] })));
    expect(result.isError).toBe(false);
    expect(textOf(result)).toMatch(/No hotels/);
  });

  it("candidates → listed with their destination_id and the instruction to call again", async () => {
    const result = await callTool("search_hotels", { ...SEARCH_ARGS, destination_id: undefined, destination: "San Jose" }, api(answer(200, CANDIDATES)));
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(CANDIDATES);
    const text = textOf(result);
    expect(text).toContain("San Jose, Costa Rica (city) — destination_id sj-cr");
    expect(text).toContain("destination_id");
    expect(text).toContain("Several places match");
  });
});

describe("get_hotel_rates results", () => {
  it("one line per rate plus the link and the API answer", async () => {
    const result = await callTool("get_hotel_rates", RATES_ARGS, api(answer(200, RATES_OK)));
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(RATES_OK);
    const lines = textOf(result).split("\n");
    expect(lines[0]).toContain("Hotel 1 (4.5★, Paris)");
    expect(lines[0]).toContain("2027-04-10 to 2027-04-12");
    expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(2);
    expect(textOf(result)).toContain("- Double Room — USD 123.45 total · non-refundable · beds: 1 King Bed or 2 Queen Beds · to pay at the hotel: USD 40.00 (EUR 37.00)");
    expect(textOf(result)).toContain("- Double Room — USD 12,300.00 total · free cancellation until 2027-04-07T00:00:00.000+02:00 · beds: 1 King Bed");
    expect(textOf(result)).toContain("Bed type is a request and not guaranteed");
    expect(textOf(result)).toContain(LINK);
  });
});

describe("API errors become tool errors", () => {
  const UNAVAILABLE = "Hotel search is unavailable right now. Try again in a few minutes.";

  it.each([
    ["400 → the API's message", answer(400, { error: "invalid_request", message: "Check the destination, dates and guests." }), "Check the destination, dates and guests."],
    ["404 → the API's message", answer(404, { error: "not_found", message: "This search expired. Run search_hotels again." }), "This search expired. Run search_hotels again."],
    ["429 → wait", answer(429, { error: "rate_limited", message: "x" }), "Too many searches right now. Wait a minute and try again."],
    ["503 → unavailable", answer(503, { error: "unavailable", message: "x" }), UNAVAILABLE],
    ["500 → unavailable", answer(500, { error: "server_error" }), UNAVAILABLE],
    ["403 → unavailable", answer(403, { error: "forbidden" }), UNAVAILABLE],
    ["404 without a body (feature off) → unavailable", answer(404, null), UNAVAILABLE],
    ["400 without a message → unavailable", answer(400, { error: "invalid_request" }), UNAVAILABLE],
    ["network failure or timeout → unavailable", { kind: "unavailable" } as ApiAnswer, UNAVAILABLE],
    ["200 with an unexpected shape → unavailable", answer(200, { hotels: "nope" }), UNAVAILABLE],
  ])("%s", async (_name, a, text) => {
    const result = await callTool("get_hotel_rates", RATES_ARGS, api(a));
    expect(result).toEqual({ content: [{ type: "text", text }], isError: true });
  });
});

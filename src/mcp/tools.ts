import { z } from "zod";
import type { ApiAnswer, ApiPath } from "./apolles-client";
import { INVALID_PARAMS, RpcError } from "./protocol";

// The two tools of the search-only connector (design §5). Both only read: they forward the
// checked arguments to the Apolles AI API and turn its answer into a short text plus the same
// data as structuredContent. Nothing here can book, hold, cancel or pay; no other tool exists.

export const TOOL_NAMES = ["get_hotel_rates", "search_hotels"] as const;
type ToolName = (typeof TOOL_NAMES)[number];

// Calls the AI API with the caller's token (bound by server.ts).
export type CallApi = (path: ApiPath, body: Record<string, unknown>) => Promise<ApiAnswer>;

export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError: boolean };

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const UNAVAILABLE = "Hotel search is unavailable right now. Try again in a few minutes.";
const RATE_LIMITED = "Too many searches right now. Wait a minute and try again.";

// ---------- arguments: the same fields and limits as the API body (src/server/ai/search-api.ts) ----------

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nationality = z.string().regex(/^[A-Z]{2}$/).describe("The guests' nationality as an ISO 3166-1 alpha-2 country code in capitals, e.g. IL.");

const searchArgs = z
  .object({
    destination: z.string().trim().min(2).max(60).optional().describe("A city, region or hotel name, 2-60 characters. Give this or destination_id, not both."),
    destination_id: z.string().regex(ID).optional().describe("A destination_id from an earlier search_hotels answer that listed candidates."),
    checkin: z.string().regex(DATE).describe("Check-in date, YYYY-MM-DD."),
    checkout: z.string().regex(DATE).describe("Check-out date, YYYY-MM-DD."),
    rooms: z
      .array(
        z
          .object({
            adults: z.number().int().min(1).max(8).describe("Adults in this room, 1-8."),
            child_ages: z.array(z.number().int().min(0).max(17)).max(6).describe("The age of each child in this room (0-17), up to 6; [] for none."),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .describe("1-8 rooms, each with its guests."),
    nationality,
    max_results: z.number().int().min(1).max(20).optional().describe("How many hotels to return, 1-20. Default 10."),
    sort: z.enum(["recommended", "price_asc", "stars_desc"]).optional().describe("Order of the hotels. Default recommended."),
    min_stars: z.number().int().min(0).max(5).optional().describe("Only hotels with at least this many stars, 0-5."),
    free_cancellation_only: z.boolean().optional().describe("Only hotels that have a rate with free cancellation."),
  })
  .strict()
  .refine((b) => (b.destination === undefined) !== (b.destination_id === undefined), { path: ["destination"], message: "Give either destination or destination_id." });

const ratesArgs = z
  .object({
    search_id: z.string().regex(ID).describe("The search_id from the search_hotels answer."),
    hotel_id: z.string().regex(ID).describe("The hotel_id of one hotel in that answer."),
    nationality: nationality.optional(),
  })
  .strict();

// ---------- answers: read with the fields the API sends; anything else is dropped ----------

const money = z.object({ amount: z.string().regex(/^-?\d+(\.\d+)?$/), currency: z.string().regex(/^[A-Z]{3}$/) });

const hotel = z.object({
  hotel_id: z.string(),
  name: z.string(),
  city: z.string(),
  stars: z.number().nullable(),
  cheapest_total: money,
  free_cancellation_available: z.boolean(),
  fees_at_hotel: z.boolean(),
  other_rates: z.number(),
  link: z.string(),
});

const searchFound = z.object({
  search_id: z.string(),
  destination: z.object({ destination_id: z.string(), name: z.string() }),
  nights: z.number(),
  total_hotels: z.number(),
  hotels: z.array(hotel),
  notes: z.array(z.string()),
});

const searchCandidates = z.object({
  candidates: z.array(z.object({ destination_id: z.string(), name: z.string(), type: z.string() })),
  message: z.string(),
});

const rate = z.object({
  room_name: z.string(),
  bed_types: z.array(z.string()),
  bed_type_note: z.string(),
  refundable: z.boolean(),
  free_cancellation_until: z.string().nullable(),
  total: money,
  taxes_and_fees: money.nullable(),
  fees_at_hotel: z.array(z.object({ kind: z.string(), amount: money, local_amount: money.nullable() })),
  amenities: z.array(z.string()),
});

const ratesFound = z.object({
  search_id: z.string(),
  hotel: z.object({ hotel_id: z.string(), name: z.string(), city: z.string(), stars: z.number().nullable() }),
  stay: z.object({
    checkin: z.string(),
    checkout: z.string(),
    nights: z.number(),
    rooms: z.array(z.object({ adults: z.number(), child_ages: z.array(z.number()) })),
  }),
  rates: z.array(rate),
  link: z.string(),
});

const apiError = z.object({ error: z.string(), message: z.string().min(1).max(500) });

// ---------- text summaries ----------

// Names come from hotel data: kept on one line so the summary keeps one hotel per line.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function price(m: z.infer<typeof money>): string {
  const [, sign = "", whole = "", fraction = ""] = /^(-?)(\d+)(\.\d+)?$/.exec(m.amount) ?? [];
  return `${m.currency} ${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

function where(stars: number | null, city: string): string {
  const parts = [stars === null ? "" : `${stars}★`, oneLine(city)].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function searchText(found: z.infer<typeof searchFound>): string {
  const head = `Hotels in ${oneLine(found.destination.name)} for ${plural(found.nights, "night")}: ${found.total_hotels} found, ${found.hotels.length} shown. search_id ${found.search_id} (for get_hotel_rates).`;
  const lines = found.hotels.map((h) =>
    [
      `${oneLine(h.name)}${where(h.stars, h.city)} — from ${price(h.cheapest_total)} total`,
      ...(h.free_cancellation_available ? ["free cancellation available"] : []),
      h.link,
      `hotel_id ${h.hotel_id}`,
    ].join(" · "),
  );
  if (lines.length === 0) lines.push("No hotels found for these dates and guests.");
  return [head, ...lines, ...found.notes].join("\n");
}

function candidatesText(found: z.infer<typeof searchCandidates>): string {
  const lines = found.candidates.map((c) => `- ${oneLine(c.name)} (${oneLine(c.type)}) — destination_id ${c.destination_id}`);
  return [found.message, ...lines, "Call search_hotels again with the destination_id of the place meant."].join("\n");
}

function rateLine(r: z.infer<typeof rate>): string {
  const cancellation = !r.refundable ? "non-refundable" : r.free_cancellation_until ? `free cancellation until ${r.free_cancellation_until}` : "refundable";
  const parts = [`- ${oneLine(r.room_name)} — ${price(r.total)} total`, cancellation];
  if (r.bed_types.length) parts.push(`beds: ${r.bed_types.map(oneLine).join(" or ")}`);
  if (r.fees_at_hotel.length) {
    parts.push(`to pay at the hotel: ${r.fees_at_hotel.map((f) => `${price(f.amount)}${f.local_amount ? ` (${price(f.local_amount)})` : ""}`).join(", ")}`);
  }
  return parts.join(" · ");
}

function ratesText(found: z.infer<typeof ratesFound>): string {
  const { hotel: h, stay } = found;
  const head = `${oneLine(h.name)}${where(h.stars, h.city)}, ${stay.checkin} to ${stay.checkout}, ${plural(stay.nights, "night")}, ${plural(stay.rooms.length, "room")}: ${plural(found.rates.length, "rate")}, cheapest first.`;
  const lines = found.rates.map(rateLine);
  if (lines.length === 0) lines.push("No rates are available for this hotel now.");
  const note = found.rates[0]?.bed_type_note;
  return [head, ...lines, ...(note ? [`${note}.`] : []), `Book in Apolles: ${found.link}`].join("\n");
}

// ---------- the tools ----------

type Tool = {
  title: string;
  description: string;
  args: z.ZodType<Record<string, unknown>>;
  path: ApiPath;
  // The 200 answer as text + data, or null if it does not read as expected.
  read(json: unknown): { text: string; data: Record<string, unknown> } | null;
};

function reader<T extends Record<string, unknown>>(schema: z.ZodType<T>, text: (data: T) => string) {
  return (json: unknown) => {
    const parsed = schema.safeParse(json);
    return parsed.success ? { text: text(parsed.data), data: parsed.data } : null;
  };
}

const TOOLS: Record<ToolName, Tool> = {
  get_hotel_rates: {
    title: "Get hotel rates",
    description:
      "List the room rates of one hotel from a search_hotels result: room name, bed types, refundable or not, free cancellation deadline, total price for the whole stay, taxes and fees, fees to pay at the hotel, and a link to book in Apolles. Give the search_id and hotel_id from search_hotels; a search expires after 30 minutes. Read-only: this tool cannot book, hold or cancel anything.",
    args: ratesArgs,
    path: "rates",
    read: reader(ratesFound, ratesText),
  },
  search_hotels: {
    title: "Search hotels",
    description:
      "Search Apolles hotel availability and prices for one destination, check-in and check-out dates, rooms with their guests, and the guests' nationality. Returns hotels with the cheapest total price for the whole stay (all rooms), whether free cancellation is available, and a link to book in Apolles. If several places match the destination text, it returns candidates instead: call again with the chosen destination_id. Read-only: this tool cannot book, hold or cancel anything; booking happens only in Apolles.",
    args: searchArgs,
    path: "search",
    read: (json) => reader(searchFound, searchText)(json) ?? reader(searchCandidates, candidatesText)(json),
  },
};

function inputSchema(schema: z.ZodType): Record<string, unknown> {
  // The dialect line is left out: MCP's default (2020-12) is what Zod writes.
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const LISTED = TOOL_NAMES.map((name) => ({
  name,
  title: TOOLS[name].title,
  description: TOOLS[name].description,
  inputSchema: inputSchema(TOOLS[name].args),
  annotations: ANNOTATIONS,
}));

export function listTools(): typeof LISTED {
  return LISTED;
}

const isToolName = (name: unknown): name is ToolName => (TOOL_NAMES as readonly unknown[]).includes(name);

// Where each problem is, without the values sent.
function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((issue) => {
    const at = issue.path.length ? issue.path.join(".") : "arguments";
    if (issue.code === "unrecognized_keys") return `${at}: fields this tool does not take: ${issue.keys.join(", ")}`;
    return `${at}: ${issue.message}`;
  });
}

const failure = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

function fromAnswer(tool: Tool, answer: ApiAnswer): ToolResult {
  if (answer.kind === "unavailable") return failure(UNAVAILABLE);
  if (answer.status === 200) {
    const read = tool.read(answer.json);
    return read ? { content: [{ type: "text", text: read.text }], structuredContent: read.data, isError: false } : failure(UNAVAILABLE);
  }
  if (answer.status === 429) return failure(RATE_LIMITED);
  if (answer.status === 400 || answer.status === 404) {
    // Apolles' own plain message (it never echoes the request); without one, the search is off.
    const error = apiError.safeParse(answer.json);
    return failure(error.success ? error.data.message : UNAVAILABLE);
  }
  return failure(UNAVAILABLE);
}

export async function callTool(name: unknown, args: unknown, api: CallApi): Promise<ToolResult> {
  if (!isToolName(name)) throw new RpcError(INVALID_PARAMS, "Invalid params", { issues: ["name: no such tool"] });
  const tool = TOOLS[name];
  const parsed = tool.args.safeParse(args);
  if (!parsed.success) throw new RpcError(INVALID_PARAMS, "Invalid params", { issues: issuesOf(parsed.error) });
  return fromAnswer(tool, await api(tool.path, parsed.data));
}

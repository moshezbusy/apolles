import { z } from "zod";

// The Apolles MCP connector: what Claude and ChatGPT talk to (plan 2026-11-22-mcp-search-connector).
//
// It runs as its own process (src/mcp-server.ts, its own container) and is kept as small as
// possible on purpose:
// - It holds no database address, no supplier keys and no secrets at all; src/mcp-server.ts
//   refuses to start if any of them is in its environment. It imports nothing from the app
//   (only zod and Node), so the booking code is not even loaded.
// - It has exactly two tools, search_hotels and get_hotel_rates. Any other tool name is an error.
//   Booking, cancellation, vouchers, the balance, clients and guests do not exist here.
// - It does not check tokens itself: it passes the assistant's token to the app's assistant search
//   API (src/app/api/assistant/*), which checks it (scope search:read, issued for this connector's
//   address, agent and agency active) and answers. A refused token gives the MCP 401 challenge, so
//   the assistant signs in again (OAuth, served by the app).
// - MCP over Streamable HTTP, stateless: one JSON-RPC request per POST, answered as JSON (no
//   server-sent events, no sessions). Written without the MCP SDK: the SDK would bring 17 more
//   packages (a web framework among them) into the one process that faces the internet, for four
//   JSON-RPC methods (supply-chain review in the plan).

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
const LATEST = PROTOCOL_VERSIONS[0];
const MAX_BODY_BYTES = 64 * 1024;
const APP_TIMEOUT_MS = 90_000;
const SCOPE = "search:read";
// Browsers send an Origin header; Claude's and ChatGPT's servers do not. A request from any other
// web page is refused (MCP: servers must check Origin, against DNS rebinding).
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://claude.com", "https://chatgpt.com"]);

export type McpConfig = {
  resource: string; // the public connector address, e.g. https://mcp.example.com/mcp
  issuer: string; // the app's origin: the OAuth authorization server
  appInternalUrl: string; // where this process reaches the app, e.g. http://apolles-staging:3000
  version: string;
};

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const AUTH_META = { securitySchemes: [{ type: "oauth2", scopes: [SCOPE] }] } as const;

const room = {
  type: "object",
  properties: {
    adults: { type: "integer", minimum: 1, maximum: 8 },
    childAges: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 }, maxItems: 6, description: "Age of each child at check-in. Empty if none." },
  },
  required: ["adults", "childAges"],
  additionalProperties: false,
} as const;

// The two tools. The app checks every argument again (strict Zod, unknown fields refused).
export const TOOLS = [
  {
    name: "search_hotels",
    title: "Search hotels",
    description:
      "Search hotels in a destination for given dates and rooms, for the signed-in Apolles travel agent. " +
      "Returns hotels with the lowest price for the whole stay, star rating, whether free cancellation is available, " +
      "and a link to open the hotel in Apolles. Search only: this cannot book, hold, cancel or pay. " +
      "Prices are the agency's net prices and are checked again when the agent books in Apolles.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", minLength: 2, maxLength: 60, description: "City or area name in English, e.g. \"Paris\". Use this or destinationId." },
        destinationId: { type: "string", maxLength: 64, description: "A destination id from an earlier result's otherDestinations." },
        checkin: { type: "string", format: "date", description: "Check-in date, YYYY-MM-DD." },
        checkout: { type: "string", format: "date", description: "Check-out date, YYYY-MM-DD. 1 to 28 nights." },
        rooms: { type: "array", items: room, minItems: 1, maxItems: 8, description: "One entry per room." },
        hotelName: { type: "string", maxLength: 100, description: "Only hotels whose name contains this text." },
        stars: { type: "array", items: { type: "integer", minimum: 1, maximum: 5 }, maxItems: 5, description: "Only these star ratings." },
        freeCancellationOnly: { type: "boolean" },
        maxTotalPrice: { type: "integer", minimum: 1, description: "Highest price for the whole stay, in whole US dollars." },
        sort: { type: "string", enum: ["recommended", "price_asc", "price_desc", "stars_desc"] },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "How many hotels to return (default 10)." },
      },
      required: ["checkin", "checkout", "rooms"],
      additionalProperties: false,
    },
    annotations: { title: "Search hotels", ...READ_ONLY },
    _meta: AUTH_META,
  },
  {
    name: "get_hotel_rates",
    title: "Get hotel rates",
    description:
      "List the room rates of one hotel from a search_hotels result: room, beds, what is included (e.g. breakfast), " +
      "total and average nightly price, taxes and fees, fees paid at the hotel, and the cancellation rule. " +
      "Search only: this cannot book. To book, the agent opens the link in Apolles.",
    inputSchema: {
      type: "object",
      properties: {
        searchId: { type: "string", maxLength: 64, description: "searchId from search_hotels (open for 30 minutes)." },
        hotelId: { type: "string", maxLength: 64, description: "hotelId from search_hotels." },
      },
      required: ["searchId", "hotelId"],
      additionalProperties: false,
    },
    annotations: { title: "Get hotel rates", ...READ_ONLY },
    _meta: AUTH_META,
  },
] as const;

const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));

const INSTRUCTIONS =
  "Apolles hotel search for travel agents. Search only: no booking, cancellation, vouchers, balance, clients or guest data. " +
  "Use search_hotels first, then get_hotel_rates with its searchId and hotelId. Share the openInApolles link so the agent can book in Apolles.";

const message = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(200), z.number().int()]).optional(),
    method: z.string().max(100),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const toolCall = z.object({ name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).optional(), _meta: z.unknown().optional() }).strict();

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function rpcResult(id: string | number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: JSON_HEADERS });
}

function rpcError(id: string | number | null, code: number, text: string, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: text } }), { status, headers: JSON_HEADERS });
}

function bearerOf(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

export function createMcpHandler(config: McpConfig, fetchApp: Fetch = fetch): (request: Request) => Promise<Response> {
  const mcpPath = new URL(config.resource).pathname;
  const metadataPath = `/.well-known/oauth-protected-resource${mcpPath === "/" ? "" : mcpPath}`;
  const metadataUrl = `${new URL(config.resource).origin}${metadataPath}`;
  const metadata = {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Apolles hotel search (search only)",
  };

  const challenge = (invalid: boolean) =>
    new Response(JSON.stringify({ error: invalid ? "invalid_token" : "unauthorized" }), {
      status: 401,
      headers: {
        ...JSON_HEADERS,
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", scope="${SCOPE}"${invalid ? ', error="invalid_token", error_description="Sign in to Apolles again."' : ""}`,
      },
    });

  async function callApp(path: string, token: string, body: unknown): Promise<Response | null> {
    try {
      return await fetchApp(`${config.appInternalUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(APP_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      return null;
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === metadataPath || url.pathname === "/.well-known/oauth-protected-resource")) {
      return new Response(JSON.stringify(metadata), { status: 200, headers: { ...JSON_HEADERS, "Cache-Control": "public, max-age=300" } });
    }
    if (request.method === "GET" && url.pathname === "/healthz") return new Response("ok", { status: 200, headers: { "Cache-Control": "no-store" } });
    if (url.pathname !== mcpPath) return new Response("Not found", { status: 404 });
    // No server-sent event stream and no sessions: GET and DELETE are not offered (MCP allows 405).
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

    const origin = request.headers.get("origin");
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden", { status: 403 });

    const token = bearerOf(request);
    if (!token) return challenge(false);

    const version = request.headers.get("mcp-protocol-version");
    if (version !== null && !(PROTOCOL_VERSIONS as readonly string[]).includes(version)) return rpcError(null, -32600, "Unsupported MCP protocol version.", 400);
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return rpcError(null, -32700, "Send JSON.", 415);
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return rpcError(null, -32600, "Request too large.", 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return rpcError(null, -32700, "Parse error.", 400);
    }
    const parsed = message.safeParse(raw);
    if (!parsed.success) return rpcError(null, -32600, "Invalid request.", 400);
    const { id, method, params } = parsed.data;

    // A notification (no id) or a client's reply needs no answer: 202, after the token check.
    if (id === undefined) {
      const check = await callApp("/api/assistant/check", token, {});
      if (!check || check.status === 401) return check ? challenge(true) : rpcError(null, -32603, "Apolles is unavailable.", 503);
      return new Response(null, { status: 202 });
    }

    if (method === "tools/call") {
      const call = toolCall.safeParse(params);
      if (!call.success) return rpcError(id, -32602, "Invalid tool call.");
      if (!TOOL_NAMES.has(call.data.name)) return rpcError(id, -32602, `Unknown tool: only ${[...TOOL_NAMES].join(" and ")} exist.`);
      const answer = await callApp(`/api/assistant/${call.data.name}`, token, call.data.arguments ?? {});
      if (!answer) return rpcResult(id, { isError: true, content: [{ type: "text", text: "Apolles is unavailable right now. Try again in a few minutes." }] });
      if (answer.status === 401) return challenge(true);
      const body = (await answer.json().catch(() => null)) as { ok?: unknown; data?: unknown; message?: unknown } | null;
      if (!body || typeof body !== "object") return rpcResult(id, { isError: true, content: [{ type: "text", text: "Apolles is unavailable right now. Try again in a few minutes." }] });
      if (body.ok === true && body.data && typeof body.data === "object") {
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(body.data) }], structuredContent: body.data });
      }
      const reason = typeof body.message === "string" ? body.message.slice(0, 500) : "The search could not run.";
      return rpcResult(id, { isError: true, content: [{ type: "text", text: reason }] });
    }

    // initialize, ping and tools/list need a good token too (every MCP request carries one).
    const check = await callApp("/api/assistant/check", token, {});
    if (!check) return rpcError(id, -32603, "Apolles is unavailable right now.", 503);
    if (check.status === 401) return challenge(true);
    if (check.status !== 204) return rpcError(id, -32603, "Apolles is unavailable right now.", 503);

    switch (method) {
      case "initialize": {
        const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST;
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "apolles-search", title: "Apolles hotel search", version: config.version },
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: TOOLS });
      default:
        return rpcError(id, -32601, "Method not found.");
    }
  };
}

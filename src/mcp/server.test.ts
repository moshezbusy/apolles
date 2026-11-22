import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "./config";
import { createMcpServer } from "./server";

// The MCP server over real HTTP (port 0), with the Apolles API replaced by a fetch spy.

const CFG: McpConfig = {
  publicUrl: "https://mcp.example.test",
  internalUrl: "http://apolles.internal:3000",
  serviceKey: "test-service-key-0123456789",
  authServer: "https://app.example.test",
  port: 0,
};
const TOKEN = "apl_at_Zm9vYmFyLXNlY3JldC10b2tlbg.x-y_z";
const WWW_AUTHENTICATE = 'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource", scope="search:read"';
const PRM = {
  resource: "https://mcp.example.test/mcp",
  authorization_servers: ["https://app.example.test"],
  scopes_supported: ["search:read"],
  bearer_methods_supported: ["header"],
};
const UNAVAILABLE = "Hotel search is unavailable right now. Try again in a few minutes.";

const SEARCH_OK = {
  search_id: "snap_123",
  destination: { destination_id: "paris", name: "Paris, France" },
  nights: 2,
  total_hotels: 1,
  hotels: [
    {
      hotel_id: "1",
      name: "Hotel 1",
      city: "Paris",
      stars: 4,
      cheapest_total: { amount: "123.45", currency: "USD" },
      free_cancellation_available: true,
      fees_at_hotel: false,
      other_rates: 0,
      link: "https://app.example.test/search/open?hotel=1",
    },
  ],
  notes: ["Prices are checked again before booking. Book in Apolles."],
};
const SEARCH_ARGS = { destination_id: "paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, child_ages: [] }], nationality: "IL" };

type Reply = { status: number; headers: http.IncomingHttpHeaders; text: string; json: unknown };

let server: http.Server;
let port: number;
let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
let logged: string[];

function jsonResponse(status: number, json: unknown): Response {
  return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(async () => {
  fetchSpy = vi.fn<typeof fetch>(async () => jsonResponse(200, SEARCH_OK));
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  server = createMcpServer(CFG, fetchSpy);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(method: string, path: string, opts: { headers?: Record<string, string>; body?: string | Buffer; chunks?: Buffer[] } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: opts.headers ?? {} }, (res) => {
      const parts: Buffer[] = [];
      res.on("data", (c: Buffer) => parts.push(c));
      res.on("end", () => {
        const text = Buffer.concat(parts).toString("utf8");
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (opts.chunks) for (const c of opts.chunks) req.write(c);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const rpc = (body: unknown, headers: Record<string, string> = auth) => send("POST", "/mcp", { headers, body: JSON.stringify(body) });
const call = (name: string, args: unknown, id: number | string = 1) => rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("protected resource metadata (RFC 9728)", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])("GET %s", async (path) => {
    const res = await send("GET", path);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json).toEqual(PRM);
  });

  it("trailing slashes in the configured addresses are dropped", async () => {
    const other = createMcpServer({ ...CFG, publicUrl: "https://mcp.example.test/", authServer: "https://app.example.test/" }, fetchSpy);
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const mainPort = port;
    port = (other.address() as AddressInfo).port;
    try {
      expect((await send("GET", "/.well-known/oauth-protected-resource")).json).toEqual(PRM);
      fetchSpy.mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }));
      expect((await call("search_hotels", SEARCH_ARGS)).headers["www-authenticate"]).toBe(WWW_AUTHENTICATE);
    } finally {
      port = mainPort;
      await new Promise<void>((resolve) => other.close(() => resolve()));
    }
  });

  it("POST to the metadata → 405", async () => {
    expect((await send("POST", "/.well-known/oauth-protected-resource")).status).toBe(405);
  });
});

describe("authentication", () => {
  it.each([
    ["no Authorization header", { "Content-Type": "application/json" }],
    ["an empty bearer", { Authorization: "Bearer ", "Content-Type": "application/json" }],
    ["another scheme", { Authorization: `Basic ${TOKEN}`, "Content-Type": "application/json" }],
  ])("%s → 401 with WWW-Authenticate, for every method, without calling the API", async (_name, headers) => {
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_hotels", arguments: SEARCH_ARGS } },
    ]) {
      const res = await rpc(body, headers);
      expect(res.status).toBe(401);
      expect(res.headers["www-authenticate"]).toBe(WWW_AUTHENTICATE);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the API answers 401 → HTTP 401 with the exact WWW-Authenticate; the token is never logged", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }));
    const res = await call("search_hotels", SEARCH_ARGS);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe(WWW_AUTHENTICATE);
    expect(res.text).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain("Zm9vYmFy");
  });

  it("in a batch, a refused token makes the whole answer 401", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }));
    const res = await rpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_hotels", arguments: SEARCH_ARGS } },
    ]);
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe(WWW_AUTHENTICATE);
  });
});

describe("POST /mcp", () => {
  it("initialize: the version asked (or 2025-11-25), no session id, JSON", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["mcp-session-id"]).toBeUndefined();
    expect(res.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } } } });
    const unknown = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2030-01-01" } });
    expect(unknown.json).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("notifications/initialized → 202 with no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.text).toBe("");
  });

  it("tools/list: the two tools, sorted, without calling the API", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (res.json as { result: { tools: { name: string; annotations: unknown; inputSchema: Record<string, unknown> }[] } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["get_hotel_rates", "search_hotels"]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no booking tool exists: tools/call book_hotel → -32602", async () => {
    const res = await call("book_hotel", { hotel_id: "1" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tools/call forwards the token unchanged, sets the service key, posts the arguments, 10 s timeout, no redirects", async () => {
    const res = await call("search_hotels", SEARCH_ARGS);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: SEARCH_OK } });
    const text = (res.json as { result: { content: { text: string }[] } }).result.content[0]!.text;
    expect(text).toContain("Hotel 1 (4★, Paris) — from USD 123.45 total · free cancellation available");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://apolles.internal:3000/api/ai/v1/search");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("x-apolles-service-key")).toBe(CFG.serviceKey);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(SEARCH_ARGS);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(CFG.serviceKey);
  });

  it("get_hotel_rates posts to /rates", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(404, { error: "not_found", message: "This search expired. Run search_hotels again." }));
    const res = await call("get_hotel_rates", { search_id: "snap_123", hotel_id: "1" });
    expect(fetchSpy.mock.calls[0]![0]).toBe("http://apolles.internal:3000/api/ai/v1/rates");
    expect(res.json).toMatchObject({ result: { isError: true, content: [{ type: "text", text: "This search expired. Run search_hotels again." }] } });
  });

  it("an API timeout or network failure → a tool error, not a crash", async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const timeout = await call("search_hotels", SEARCH_ARGS);
    expect(timeout.json).toMatchObject({ result: { isError: true, content: [{ text: UNAVAILABLE }] } });
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    const network = await call("search_hotels", SEARCH_ARGS);
    expect(network.json).toMatchObject({ result: { isError: true, content: [{ text: UNAVAILABLE }] } });
    fetchSpy.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    const bad = await call("search_hotels", SEARCH_ARGS);
    expect(bad.json).toMatchObject({ result: { isError: true, content: [{ text: UNAVAILABLE }] } });
  });

  it("arguments with an unknown field → -32602, no API call", async () => {
    const res = await call("search_hotels", { ...SEARCH_ARGS, price_override: 1 });
    expect(res.json).toMatchObject({ error: { code: -32602 } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("malformed JSON → -32700", async () => {
    const res = await send("POST", "/mcp", { headers: auth, body: "{oops" });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("a batch is answered as an array", async () => {
    const res = await rpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(res.status).toBe(200);
    expect((res.json as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
  });

  it("MCP-Protocol-Version: a supported one passes, another → 400", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { ...auth, "MCP-Protocol-Version": "2025-06-18" })).status).toBe(200);
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { ...auth, "MCP-Protocol-Version": "2024-11-05" })).status).toBe(400);
  });

  it("a body over 64 KB → 413, whether declared or streamed", async () => {
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70_000) } });
    expect((await send("POST", "/mcp", { headers: auth, body: big })).status).toBe(413);
    const chunk = Buffer.alloc(16 * 1024, "x");
    const streamed = await send("POST", "/mcp", { headers: { ...auth, "Transfer-Encoding": "chunked" }, chunks: [chunk, chunk, chunk, chunk, chunk] });
    expect(streamed.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a client that goes away mid-body: the request is settled (logged), not left pending", async () => {
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    socket.write(`POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"jsonrpc":`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();
    await vi.waitFor(() => expect(logged.some((l) => /^mcp POST \/mcp 400 \d+ms$/.test(l))).toBe(true), { timeout: 2_000 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("id 0 and a numeric id come back as sent", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 0, method: "ping" })).json).toEqual({ jsonrpc: "2.0", id: 0, result: {} });
    expect((await rpc({ jsonrpc: "2.0", id: 7, method: "tools/list" })).json).toMatchObject({ jsonrpc: "2.0", id: 7, result: { tools: expect.any(Array) } });
    expect((await call("search_hotels", SEARCH_ARGS, 0)).json).toMatchObject({ jsonrpc: "2.0", id: 0, result: { isError: false } });
  });

  it("a batch with 3 tool calls: 2 run, the third gets -32600", async () => {
    const toolCall = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "search_hotels", arguments: SEARCH_ARGS } });
    const res = await rpc([toolCall(1), toolCall(2), toolCall(3)]);
    expect(res.status).toBe(200);
    expect((res.json as unknown[])[2]).toEqual({ jsonrpc: "2.0", id: 3, error: { code: -32600, message: "Too many tool calls in one batch" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a body just under 64 KB is read", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(60_000) } });
    expect((await send("POST", "/mcp", { headers: auth, body })).status).toBe(200);
  });
});

describe("origins, methods and paths", () => {
  it("an Origin other than claude.ai or chatgpt.com → 403", async () => {
    for (const origin of ["https://evil.example", "https://claude.ai.evil.example", "http://claude.ai", "null"]) {
      const res = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { ...auth, Origin: origin });
      expect(res.status).toBe(403);
    }
    expect((await send("GET", "/.well-known/oauth-protected-resource", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    for (const origin of ["https://claude.ai", "https://chatgpt.com"]) {
      expect((await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { ...auth, Origin: origin })).status).toBe(200);
    }
  });

  it("GET and DELETE /mcp → 405 (no SSE, no sessions)", async () => {
    expect((await send("GET", "/mcp", { headers: auth })).status).toBe(405);
    expect((await send("DELETE", "/mcp", { headers: auth })).status).toBe(405);
  });

  it("any other path → 404", async () => {
    for (const path of ["/", "/mcp/", "/api/ai/v1/search", "/.well-known/oauth-authorization-server"]) {
      expect((await send("POST", path, { headers: auth, body: "{}" })).status).toBe(404);
    }
  });
});

describe("logging", () => {
  it("one line per request: method, rpc method, tool, status, ms; never arguments", async () => {
    await call("search_hotels", { ...SEARCH_ARGS, destination_id: "paris-secret-dest" });
    await send("GET", "/.well-known/oauth-protected-resource");
    const lines = logged.filter((l) => l.startsWith("mcp "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^mcp POST \/mcp tools\/call search_hotels 200 \d+ms$/);
    expect(lines[1]).toMatch(/^mcp GET \/\.well-known\/oauth-protected-resource 200 \d+ms$/);
    expect(logged.join("\n")).not.toContain("paris-secret-dest");
  });

  it("method names the client made up are not logged as sent", async () => {
    await rpc({ jsonrpc: "2.0", id: 1, method: "evil\nINJECTED line" });
    await call("evil\ntool", {});
    expect(logged.join("\n")).not.toContain("INJECTED");
    expect(logged.join("\n")).not.toContain("evil");
  });
});

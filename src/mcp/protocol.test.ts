import { describe, expect, it, vi } from "vitest";
import { handleRpc, LATEST_VERSION, negotiateVersion, RpcError, SUPPORTED_VERSIONS, type McpMethods } from "./protocol";

// JSON-RPC 2.0 framing and the MCP methods, without HTTP.

function methods(overrides: Partial<McpMethods> = {}): McpMethods {
  return {
    listTools: () => [{ name: "a_tool" }],
    callTool: vi.fn(async () => ({ content: [], isError: false })),
    ...overrides,
  };
}

const run = (body: unknown, m = methods()) => handleRpc(typeof body === "string" ? body : JSON.stringify(body), m);

describe("protocol versions", () => {
  it("the three supported versions, newest last", () => {
    expect(SUPPORTED_VERSIONS).toEqual(["2025-03-26", "2025-06-18", "2025-11-25"]);
    expect(LATEST_VERSION).toBe("2025-11-25");
  });

  it("a supported version is answered as asked; an unknown or missing one gets 2025-11-25", () => {
    expect(negotiateVersion("2025-03-26")).toBe("2025-03-26");
    expect(negotiateVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateVersion("2024-11-05")).toBe("2025-11-25");
    expect(negotiateVersion("1999-01-01")).toBe("2025-11-25");
    expect(negotiateVersion(undefined)).toBe("2025-11-25");
    expect(negotiateVersion(42)).toBe("2025-11-25");
  });
});

describe("initialize", () => {
  it("answers the version, tools capability without listChanged, and no session", async () => {
    const out = await run({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "apolles-search" } },
    });
  });

  it("an unknown version → 2025-11-25", async () => {
    const out = await run({ jsonrpc: "2.0", id: "x", method: "initialize", params: { protocolVersion: "2099-01-01" } });
    expect(out.body).toMatchObject({ id: "x", result: { protocolVersion: "2025-11-25" } });
  });
});

describe("framing", () => {
  it("malformed JSON → -32700 with id null, HTTP 400", async () => {
    const out = await run("{not json");
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("not a request object → -32600", async () => {
    for (const bad of [42, JSON.stringify("text"), null, { id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, method: 7 }, { jsonrpc: "2.0", id: null, method: "ping" }, { jsonrpc: "2.0", id: { a: 1 }, method: "ping" }]) {
      const out = await run(bad);
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" } });
    }
  });

  it("an empty batch → -32600", async () => {
    const out = await run([]);
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: { code: -32600 } });
  });

  it("a batch: answers in order, notifications get no answer, a bad member gets its own error", async () => {
    const out = await run([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "no/such" },
      { nope: true },
    ]);
    expect(out.status).toBe(200);
    expect(out.body).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "a_tool" }] } },
      { jsonrpc: "2.0", id: 3, error: { code: -32601, message: "Method not found" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
    ]);
  });

  it("more than 10 messages in a batch → -32600", async () => {
    const out = await run(Array.from({ length: 11 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" })));
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ error: { code: -32600 } });
  });

  it("at most 2 tools/call in one batch: the others get -32600 and are not run", async () => {
    const callTool = vi.fn(async () => ({ content: [], isError: false }));
    const toolCall = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "t", arguments: {} } });
    const out = await run([toolCall(1), { jsonrpc: "2.0", id: 2, method: "ping" }, toolCall(3), toolCall(4), toolCall(5)], methods({ callTool }));
    expect(out.status).toBe(200);
    expect(out.body).toEqual([
      { jsonrpc: "2.0", id: 1, result: { content: [], isError: false } },
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", id: 3, result: { content: [], isError: false } },
      { jsonrpc: "2.0", id: 4, error: { code: -32600, message: "Too many tool calls in one batch" } },
      { jsonrpc: "2.0", id: 5, error: { code: -32600, message: "Too many tool calls in one batch" } },
    ]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("id 0 and numeric ids are answered as sent", async () => {
    expect((await run({ jsonrpc: "2.0", id: 0, method: "ping" })).body).toEqual({ jsonrpc: "2.0", id: 0, result: {} });
    expect((await run({ jsonrpc: "2.0", id: 7, method: "ping" })).body).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("only notifications (or responses) → 202 with no body", async () => {
    expect(await run({ jsonrpc: "2.0", method: "notifications/initialized" })).toMatchObject({ status: 202, body: null });
    expect(await run([{ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }, { jsonrpc: "2.0", id: 9, result: {} }])).toMatchObject({
      status: 202,
      body: null,
    });
  });

  it("an unknown method → -32601; a notification of an unknown method is ignored", async () => {
    expect((await run({ jsonrpc: "2.0", id: 5, method: "resources/list" })).body).toEqual({ jsonrpc: "2.0", id: 5, error: { code: -32601, message: "Method not found" } });
    expect((await run({ jsonrpc: "2.0", method: "whatever" })).status).toBe(202);
  });

  it("names the methods and tools it saw, for the log", async () => {
    const out = await run([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_hotels", arguments: {} } },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(out.calls).toEqual([{ method: "tools/call", tool: "search_hotels" }, { method: "ping" }]);
  });
});

describe("tools", () => {
  it("tools/call passes the name and arguments; a missing arguments object is {}", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], isError: false }));
    const m = methods({ callTool });
    const out = await run({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t", arguments: { a: 1 } } }, m);
    expect(out.body).toEqual({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }], isError: false } });
    expect(callTool).toHaveBeenCalledWith("t", { a: 1 });
    await run({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "t" } }, m);
    expect(callTool).toHaveBeenLastCalledWith("t", {});
  });

  it("tools/call without params or a name → -32602", async () => {
    for (const params of [undefined, [], { arguments: {} }, { name: 3 }, { name: "t", arguments: [1] }]) {
      const out = await run({ jsonrpc: "2.0", id: 1, method: "tools/call", ...(params === undefined ? {} : { params }) });
      expect(out.body).toMatchObject({ id: 1, error: { code: -32602, message: "Invalid params" } });
    }
  });

  it("an RpcError from a tool becomes that error; other errors go up", async () => {
    const failing = methods({
      callTool: async () => {
        throw new RpcError(-32602, "Invalid params", { issues: ["x"] });
      },
    });
    expect((await run({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t" } }, failing)).body).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32602, message: "Invalid params", data: { issues: ["x"] } },
    });
    const crashing = methods({
      callTool: async () => {
        throw new TypeError("boom");
      },
    });
    await expect(run({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t" } }, crashing)).rejects.toThrow(TypeError);
  });
});

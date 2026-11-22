import { readFileSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type McpConfig, createMcpServer, readMcpConfig } from "./server";

const here = path.dirname(fileURLToPath(import.meta.url));

const config: McpConfig = {
  publicUrl: "https://mcp.example.com/mcp",
  authServer: "https://app.example.com",
  appInternalUrl: "http://app.internal:3000",
};

type AppCall = { url: string; init: RequestInit };

let calls: AppCall[];
let appResponse: () => Response;
let base: string;
let close: () => Promise<void>;

async function rpc(body: unknown, headers: Record<string, string> = { authorization: "Bearer tok-abcdefghijklmnopqrstuvwxyz" }, method = "POST") {
  const res = await fetch(`${base}/mcp`, {
    method,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

describe("MCP server (search only)", () => {
  beforeEach(async () => {
    calls = [];
    appResponse = () => Response.json({ searchId: "s1", hotels: [] });
    const fetchApp = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return appResponse();
    });
    const server = createMcpServer(config, fetchApp as unknown as typeof fetch);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterEach(async () => {
    await close();
  });

  it("has no Apolles server code, database or supplier imports: only node built-ins and its own files", () => {
    const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const entry = readFileSync(path.join(here, "../mcp-server.ts"), "utf8");
    for (const source of [entry, ...files.map((f) => readFileSync(path.join(here, f), "utf8"))]) {
      for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = m[1]!;
        expect(spec.startsWith("node:") || spec.startsWith("./") || spec === "./mcp/server", spec).toBe(true);
      }
    }
  });

  it("without a token: 401 with WWW-Authenticate pointing at the protected resource metadata", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="search:read"',
    );
    expect(calls).toHaveLength(0);
  });

  it("publishes protected resource metadata naming the app as the authorization server", async () => {
    for (const p of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: "https://mcp.example.com/mcp",
        authorization_servers: ["https://app.example.com"],
        scopes_supported: ["search:read"],
        bearer_methods_supported: ["header"],
        resource_name: "Apolles hotel search",
      });
    }
  });

  it("initialize answers with tools only, and the client's protocol version when supported", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "apolles-search" } } });
    const unknown = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknown.body.result.protocolVersion).toBe("2025-11-25");
  });

  it("lists exactly two read-only tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const tools = res.body.result.tools as { name: string; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name)).toEqual(["search_hotels", "get_hotel_rates"]);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("any other tool name fails, and nothing is sent to the app", async () => {
    for (const name of ["book_hotel", "cancel_booking", "get_balance", "__proto__", "constructor"]) {
      const res = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name, arguments: {} } });
      expect(res.body.error).toMatchObject({ code: -32602 });
    }
    expect(calls).toHaveLength(0);
  });

  it("search_hotels forwards the arguments and the agent's token to the app's search API only", async () => {
    appResponse = () => Response.json({ searchId: "s1", hotels: [{ name: "Hotel 1" }] });
    const args = { destination: "Paris", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, childAges: [] }] };
    const res = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search_hotels", arguments: args } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://app.internal:3000/api/assistant/search");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer tok-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(args);
    expect(res.body.result).toMatchObject({ isError: false, structuredContent: { searchId: "s1" } });
    expect(JSON.parse(res.body.result.content[0].text)).toMatchObject({ hotels: [{ name: "Hotel 1" }] });
  });

  it("get_hotel_rates goes to the rates API; an app error is a tool error, a 401 asks the client to sign in again", async () => {
    appResponse = () => Response.json({ error: "This search has ended." }, { status: 404 });
    const res = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_hotel_rates", arguments: { searchId: "s1", hotelId: "1" } } });
    expect(calls[0]!.url).toBe("http://app.internal:3000/api/assistant/rates");
    expect(res.body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "This search has ended." }] });

    appResponse = () => Response.json({ error: "invalid_token" }, { status: 401 });
    const expired = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_hotel_rates", arguments: { searchId: "s1", hotelId: "1" } } });
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("notifications get 202, GET gets 405, batches, bad JSON and other paths are refused", async () => {
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect((await rpc(null, undefined, "GET")).status).toBe(405);
    expect((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).body.error).toMatchObject({ code: -32600 });
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" })).body.error).toMatchObject({ code: -32601 });
    const garbage = await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: "Bearer tok-abcdefghijklmnopqrstuvwxyz", "content-type": "application/json" }, body: "{" });
    expect(garbage.status).toBe(400);
    expect((await fetch(`${base}/other`, { method: "POST" })).status).toBe(404);
  });

  it("refuses a browser Origin that is not an assistant's (DNS rebinding)", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: "Bearer tok-abcdefghijklmnopqrstuvwxyz", origin: "https://evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("refuses an oversized body without reading it all", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70_000) } });
    expect(res.status).toBe(413);
  });
});

describe("MCP server configuration", () => {
  it("refuses to start without valid https URLs", () => {
    expect(readMcpConfig({})).toBeNull();
    expect(readMcpConfig({ ASSISTANT_MCP_URL: "http://mcp.example.com/mcp", APP_URL: "https://app.example.com", APP_INTERNAL_URL: "http://app:3000" })).toBeNull();
    expect(readMcpConfig({ ASSISTANT_MCP_URL: "https://mcp.example.com/mcp", APP_URL: "https://app.example.com", APP_INTERNAL_URL: "http://app:3000" })).toEqual({
      publicUrl: "https://mcp.example.com/mcp",
      authServer: "https://app.example.com",
      appInternalUrl: "http://app:3000",
    });
  });
});

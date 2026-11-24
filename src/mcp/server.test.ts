import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMcpHandler, TOOLS } from "./server";
import { startupProblems } from "./startup";

// The MCP connector process (plan 2026-11-22-mcp-search-connector): exactly two tools, no
// secrets, nothing from the app loaded, and every request carries the assistant's token, which
// the app checks.

const config = { resource: "https://mcp.apolles.test/mcp", issuer: "https://app.apolles.test", appInternalUrl: "http://app:3000", version: "test" };
const TOKEN = `aplat_${"t".repeat(43)}`;

function appStub(answer: (path: string, body: unknown) => Response = () => new Response(null, { status: 204 })) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    return answer(path, init.body ? JSON.parse(String(init.body)) : null);
  });
}

function rpc(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return new Request("https://mcp.apolles.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) });
}

describe("MCP connector", () => {
  it("lists exactly two tools, both read-only", async () => {
    const handle = createMcpHandler(config, appStub());
    const response = await handle(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const body = (await response.json()) as { result: { tools: { name: string; annotations: Record<string, boolean> }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual(["search_hotels", "get_hotel_rates"]);
    for (const tool of body.result.tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(JSON.stringify(TOOLS).toLowerCase()).not.toMatch(/"name":"(book|cancel|voucher|balance|wallet|client|guest)/);
  });

  it("any other tool name fails without calling the app", async () => {
    const app = appStub();
    const handle = createMcpHandler(config, app);
    for (const name of ["book_hotel", "cancel_booking", "get_balance", "issue_voucher", "list_clients", "SEARCH_HOTELS", "__proto__"]) {
      const response = await handle(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } }));
      const body = (await response.json()) as { error?: { code: number } };
      expect(body.error?.code, name).toBe(-32602);
    }
    expect(app).not.toHaveBeenCalled();
  });

  it("forwards a tool call to the app's search API with the assistant's token and returns its answer", async () => {
    const app = appStub((path) => (path === "/api/assistant/search_hotels" ? Response.json({ ok: true, data: { searchId: "s1", hotels: [] } }) : new Response(null, { status: 404 })));
    const handle = createMcpHandler(config, app);
    const response = await handle(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_hotels", arguments: { destination: "Paris" } } }));
    const body = (await response.json()) as { result: { structuredContent: unknown; isError?: boolean } };
    expect(body.result.structuredContent).toEqual({ searchId: "s1", hotels: [] });
    expect(body.result.isError).toBeUndefined();
    const [url, init] = app.mock.calls[0]!;
    expect(url).toBe("http://app:3000/api/assistant/search_hotels");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init.body))).toEqual({ destination: "Paris" });
  });

  it("a refusal from the app (bad input, too many searches) is a tool error the assistant can read", async () => {
    const handle = createMcpHandler(config, appStub(() => Response.json({ ok: false, code: "rate_limited", message: "Too many searches." }, { status: 429 })));
    const body = (await (await handle(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_hotel_rates", arguments: {} } }))).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe("Too many searches.");
  });

  it("without a token: 401 with the resource metadata address, so the assistant starts the sign-in", async () => {
    const app = appStub();
    const handle = createMcpHandler(config, app);
    const response = await handle(rpc({ jsonrpc: "2.0", id: 5, method: "initialize", params: {} }, {}));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://mcp.apolles.test/.well-known/oauth-protected-resource/mcp", scope="search:read"');
    expect(app).not.toHaveBeenCalled();
  });

  it("a token the app refuses gives 401 invalid_token (on any method, tool calls included)", async () => {
    const handle = createMcpHandler(config, appStub(() => new Response(null, { status: 401 })));
    for (const body of [{ jsonrpc: "2.0", id: 6, method: "tools/list" }, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search_hotels", arguments: {} } }, { jsonrpc: "2.0", method: "notifications/initialized" }]) {
      const response = await handle(rpc(body));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  it("serves the protected resource metadata (RFC 9728) at both well-known addresses", async () => {
    const handle = createMcpHandler(config, appStub());
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await handle(new Request(`https://mcp.apolles.test${path}`));
      expect(await response.json()).toEqual({
        resource: "https://mcp.apolles.test/mcp",
        authorization_servers: ["https://app.apolles.test"],
        scopes_supported: ["search:read"],
        bearer_methods_supported: ["header"],
        resource_name: "Apolles hotel search (search only)",
      });
    }
  });

  it("initialize answers with a supported protocol version and the tools capability only", async () => {
    const handle = createMcpHandler(config, appStub());
    const asked = (await (await handle(rpc({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "2025-06-18" } }))).json()) as { result: { protocolVersion: string; capabilities: unknown } };
    expect(asked.result.protocolVersion).toBe("2025-06-18");
    expect(asked.result.capabilities).toEqual({ tools: { listChanged: false } });
    const unknown = (await (await handle(rpc({ jsonrpc: "2.0", id: 9, method: "initialize", params: { protocolVersion: "1999-01-01" } }))).json()) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
  });

  it("refuses web pages (Origin), batches, other methods, GET streams and other paths", async () => {
    const handle = createMcpHandler(config, appStub());
    expect((await handle(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }))).status).toBe(403);
    expect((await handle(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${TOKEN}`, origin: "https://claude.ai" }))).status).toBe(200);
    expect((await handle(rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }]))).status).toBe(400);
    expect(((await (await handle(rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" }))).json()) as { error: { code: number } }).error.code).toBe(-32601);
    expect((await handle(new Request("https://mcp.apolles.test/mcp", { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(405);
    expect((await handle(new Request("https://mcp.apolles.test/api/assistant/search_hotels", { method: "POST" }))).status).toBe(404);
  });

  it("refuses to start with a database address, supplier keys or other secrets in its environment", () => {
    const good = { MCP_PUBLIC_URL: "https://mcp.apolles.test/mcp", APP_URL: "https://app.apolles.test", APP_INTERNAL_URL: "http://app:3000", NODE_ENV: "production", APP_ENV: "staging" };
    expect(startupProblems(good)).toEqual([]);
    for (const name of ["DATABASE_URL", "EXPEDIA_API_KEY", "EXPEDIA_SHARED_SECRET", "SUPPLIER_LAYER_API_KEY", "POSTMARK_SERVER_TOKEN", "TOTP_ENCRYPTION_KEY", "BANK_DETAILS_IBAN"]) {
      expect(startupProblems({ ...good, [name]: "x" }).join(" "), name).toContain(name);
    }
    expect(startupProblems({ ...good, MCP_PUBLIC_URL: "http://mcp.apolles.test/mcp" })).not.toEqual([]);
    expect(startupProblems({ ...good, APP_ENV: "" })).not.toEqual([]);
  });

  it("loads nothing from the app: only zod, Node and its own files", () => {
    const dir = join(import.meta.dirname);
    const files = [...readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(dir, f)), join(dir, "..", "mcp-server.ts")];
    for (const file of files) {
      const imports = [...readFileSync(file, "utf8").matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);
      for (const spec of imports) expect(spec, `${file}: ${spec}`).toMatch(/^(zod$|node:|\.\/|\.\/mcp\/)/);
    }
  });
});

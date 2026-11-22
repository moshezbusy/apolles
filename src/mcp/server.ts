import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";

// The search-only MCP server for AI assistants (plan docs/plans/2026-11-22-mcp-search-connector.md).
// A separate process (src/mcp-server.ts), apart from the booking system:
// - It has exactly two tools, search_hotels and get_hotel_rates. No tool books, cancels, issues
//   vouchers or reads the balance, and any other tool name is refused.
// - It holds no supplier keys, no database URL and no Apolles server code: it imports only Node's
//   own modules (a test checks). It forwards the agent's token and the tool arguments to the
//   app's assistant search API, which checks the token and the input itself.
// - Streamable HTTP, stateless, plain JSON answers (no SSE stream, no session id).
// - It logs the method and status only: never a token or the arguments.

export type McpConfig = { publicUrl: string; authServer: string; appInternalUrl: string };

const SCOPE = "search:read";
const MAX_BODY = 64_000;
const APP_TIMEOUT_MS = 45_000;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
// Browsers may only call from these origins; server-to-server calls send no Origin at all.
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://chatgpt.com"]);
const BEARER = /^Bearer ([A-Za-z0-9_-]{20,128})$/;

type Env = Record<string, string | undefined>;

function httpsUrl(raw: string | undefined, allowHttp = false): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.search || url.hash || url.username || url.password) return null;
    return url.protocol === "https:" || (allowHttp && url.protocol === "http:") ? url : null;
  } catch {
    return null;
  }
}

// ASSISTANT_MCP_URL: this server's public URL. APP_URL: the app's public URL (the OAuth
// authorization server). APP_INTERNAL_URL: how this server reaches the app (private network).
export function readMcpConfig(env: Env = process.env): McpConfig | null {
  const local = env.NODE_ENV !== "production";
  const pub = httpsUrl(env.ASSISTANT_MCP_URL, local && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(env.ASSISTANT_MCP_URL ?? ""));
  const auth = httpsUrl(env.APP_URL, local && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(env.APP_URL ?? ""));
  const internal = httpsUrl(env.APP_INTERNAL_URL, true);
  if (!pub || !auth || !internal) return null;
  return { publicUrl: env.ASSISTANT_MCP_URL as string, authServer: auth.origin, appInternalUrl: internal.origin };
}

const roomSchema = {
  type: "object",
  properties: {
    adults: { type: "integer", minimum: 1, maximum: 8 },
    childAges: { type: "array", items: { type: "integer", minimum: 0, maximum: 17 }, maxItems: 6, description: "Age of each child, 0 to 17. Empty if none." },
  },
  required: ["adults", "childAges"],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: "search_hotels",
    title: "Search hotels",
    description:
      "Search Apolles hotels for a destination and dates. Returns hotels with the cheapest room, the total price for the whole stay, taxes, fees paid at the hotel, the free cancellation deadline and a link to book in Apolles. Search only: it cannot book.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", minLength: 2, maxLength: 60, description: "City or area name in English, e.g. Paris." },
        checkin: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Check-in date, YYYY-MM-DD." },
        checkout: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Check-out date, YYYY-MM-DD. 1 to 28 nights." },
        rooms: { type: "array", items: roomSchema, minItems: 1, maxItems: 8, description: "One entry per room." },
        sort: { type: "string", enum: ["recommended", "price_asc", "price_desc", "stars_desc"] },
        freeCancellationOnly: { type: "boolean" },
        maxResults: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["destination", "checkin", "checkout", "rooms"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    path: "/api/assistant/search",
  },
  {
    name: "get_hotel_rates",
    title: "Get hotel rates",
    description: "All rooms and rates of one hotel from a search_hotels result (use its searchId and hotelId). Search only: it cannot book.",
    inputSchema: {
      type: "object",
      properties: {
        searchId: { type: "string", maxLength: 64 },
        hotelId: { type: "string", maxLength: 64 },
      },
      required: ["searchId", "hotelId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    path: "/api/assistant/rates",
  },
] as const;

type JsonRpcId = string | number | null;

class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status; // no parameter property: Node's type stripping does not run those
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "Cache-Control": "no-store", ...(text ? { "Content-Type": "application/json" } : {}), ...headers });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY) {
      reject(new HttpError(413));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createMcpServer(config: McpConfig, fetchApp: typeof fetch = fetch): Server {
  const publicUrl = new URL(config.publicUrl);
  const mcpPath = publicUrl.pathname;
  const prmPath = `/.well-known/oauth-protected-resource${mcpPath === "/" ? "" : mcpPath}`;
  const challenge = `Bearer resource_metadata="${publicUrl.origin}${prmPath}", scope="${SCOPE}"`;
  const metadata = {
    resource: config.publicUrl,
    authorization_servers: [config.authServer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Apolles hotel search",
  };

  const reply = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const failure = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  async function callTool(token: string, name: unknown, args: unknown): Promise<{ result?: unknown; error?: [number, string]; unauthorized?: boolean }> {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return { error: [-32602, "Unknown tool. This server can only search hotels."] };
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return { error: [-32602, "Arguments must be an object."] };
    let res: Response;
    try {
      res = await fetchApp(`${config.appInternalUrl}${tool.path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(args ?? {}),
        signal: AbortSignal.timeout(APP_TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      return { result: { isError: true, content: [{ type: "text", text: "Apolles search is unavailable right now. Try again in a few minutes." }] } };
    }
    if (res.status === 401) return { unauthorized: true };
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok && data && typeof data === "object") {
      return { result: { isError: false, content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } };
    }
    const message = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "Apolles search is unavailable right now. Try again in a few minutes.";
    return { result: { isError: true, content: [{ type: "text", text: message }] } };
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      send(res, 405, undefined, { Allow: "POST" });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) {
      send(res, 403, { error: "origin not allowed" });
      return;
    }
    const match = BEARER.exec(req.headers.authorization ?? "");
    if (!match) {
      send(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": challenge });
      return;
    }
    const token = match[1]!;
    const text = await readBody(req);
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      send(res, 400, failure(null, -32700, "Parse error"));
      return;
    }
    if (Array.isArray(message) || typeof message !== "object" || message === null || (message as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
      send(res, 400, failure(null, -32600, "Invalid request"));
      return;
    }
    const { id, method, params } = message as { id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> };
    if (id === undefined) {
      send(res, 202, undefined); // a notification (or a response): nothing to answer
      return;
    }
    switch (method) {
      case "initialize": {
        const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
        send(
          res,
          200,
          reply(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "apolles-search", title: "Apolles hotel search", version: "1.0.0" },
            instructions: "Search only. Use search_hotels, then get_hotel_rates for one hotel. To book, the agent opens the link in Apolles.",
          }),
        );
        return;
      }
      case "ping":
        send(res, 200, reply(id, {}));
        return;
      case "tools/list":
        send(res, 200, reply(id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) }));
        return;
      case "tools/call": {
        const outcome = await callTool(token, params?.name, params?.arguments);
        if (outcome.unauthorized) {
          send(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": challenge });
          return;
        }
        if (outcome.error) {
          send(res, 200, failure(id, outcome.error[0], outcome.error[1]));
          return;
        }
        send(res, 200, reply(id, outcome.result));
        return;
      }
      default:
        send(res, 200, failure(id, -32601, "Method not found"));
    }
  }

  return createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const done = () => console.info(`mcp ${req.method} ${path === mcpPath ? "mcp" : path} ${res.statusCode}`);
    res.on("finish", done);
    if (req.method === "GET" && (path === prmPath || path === "/.well-known/oauth-protected-resource")) {
      send(res, 200, metadata, { "Cache-Control": "public, max-age=300" });
      return;
    }
    if (req.method === "GET" && path === "/healthz") {
      send(res, 200, { ok: true });
      return;
    }
    if (path !== mcpPath) {
      send(res, 404, { error: "not found" });
      return;
    }
    handleMcp(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? "request too large" : "server error" }, { Connection: "close" });
    });
  });
}

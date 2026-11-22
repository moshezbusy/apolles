// JSON-RPC 2.0 framing and the MCP methods this server answers (plan 11, task 8). Stateless:
// every POST is handled on its own, there are no sessions and nothing is kept between requests.
// The tools themselves are in tools.ts; HTTP is in server.ts.

export const SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;
export const LATEST_VERSION = "2025-11-25";

const SERVER_INFO = { name: "apolles-search", title: "Apolles hotel search", version: "1.0.0" };
const INSTRUCTIONS =
  "Search Apolles hotel availability and prices for a travel agent. Search only: booking, holds and payments happen in Apolles, through the links in the results.";

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

// More than this in one batch is refused. Tool calls run one after another, each up to the API's
// 10 s timeout, so a batch holds at most 2 of them: one request stays within the shutdown grace.
const MAX_BATCH = 10;
export const MAX_TOOL_CALLS_PER_BATCH = 2;

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export type McpMethods = {
  listTools(): unknown[];
  // Throws RpcError for an unknown tool or bad arguments. Any other error goes up to the caller
  // (server.ts turns a refused token into HTTP 401).
  callTool(name: unknown, args: unknown): Promise<unknown>;
};

type Id = string | number;
type RpcErrorBody = { code: number; message: string; data?: unknown };
export type RpcResponse = { jsonrpc: "2.0"; id: Id | null; result?: unknown; error?: RpcErrorBody };

// What the HTTP layer sends: 200 with the answer(s), 202 when nothing needs an answer (only
// notifications or responses), 400 when the body is not JSON-RPC at all. `calls` names what
// was asked, for the log (server.ts logs only names it knows).
export type RpcOutcome = { status: 200 | 202 | 400; body: RpcResponse | RpcResponse[] | null; calls: { method: string; tool?: string }[] };

export function negotiateVersion(requested: unknown): string {
  return (SUPPORTED_VERSIONS as readonly unknown[]).includes(requested) ? (requested as string) : LATEST_VERSION;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is Id => typeof v === "string" || (typeof v === "number" && Number.isInteger(v));

function errorResponse(id: Id | null, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

type Message =
  | { kind: "request"; id: Id; method: string; params: unknown }
  | { kind: "notification" }
  | { kind: "response" } // the client answering us: we never ask, so it is ignored
  | { kind: "invalid"; id: Id | null };

function classify(raw: unknown): Message {
  if (!isObject(raw) || raw.jsonrpc !== "2.0") return { kind: "invalid", id: isObject(raw) && isId(raw.id) ? raw.id : null };
  if (!("method" in raw)) {
    return ("result" in raw || "error" in raw) && "id" in raw ? { kind: "response" } : { kind: "invalid", id: isId(raw.id) ? raw.id : null };
  }
  if (typeof raw.method !== "string") return { kind: "invalid", id: isId(raw.id) ? raw.id : null };
  if (raw.params !== undefined && !isObject(raw.params) && !Array.isArray(raw.params)) return { kind: "invalid", id: isId(raw.id) ? raw.id : null };
  if (!("id" in raw)) return { kind: "notification" };
  // MCP: a request id is a string or an integer, never null.
  if (!isId(raw.id)) return { kind: "invalid", id: null };
  return { kind: "request", id: raw.id, method: raw.method, params: raw.params };
}

async function answer(req: { id: Id; method: string; params: unknown }, methods: McpMethods): Promise<RpcResponse> {
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: req.id, result });
  try {
    switch (req.method) {
      case "initialize":
        return ok({
          protocolVersion: negotiateVersion(isObject(req.params) ? req.params.protocolVersion : undefined),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: methods.listTools() });
      case "tools/call": {
        const params = req.params;
        if (!isObject(params) || typeof params.name !== "string") throw new RpcError(INVALID_PARAMS, "Invalid params");
        const args = params.arguments ?? {};
        if (!isObject(args)) throw new RpcError(INVALID_PARAMS, "Invalid params");
        return ok(await methods.callTool(params.name, args));
      }
      default:
        return errorResponse(req.id, METHOD_NOT_FOUND, "Method not found");
    }
  } catch (error) {
    if (error instanceof RpcError) return errorResponse(req.id, error.code, error.message, error.data);
    throw error;
  }
}

// One POST body. Requests of a batch are answered one after another, in order.
export async function handleRpc(text: string, methods: McpMethods): Promise<RpcOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 400, body: errorResponse(null, PARSE_ERROR, "Parse error"), calls: [] };
  }
  const batch = Array.isArray(parsed);
  const raws: unknown[] = batch ? (parsed as unknown[]) : [parsed];
  if (raws.length === 0 || raws.length > MAX_BATCH) return { status: 400, body: errorResponse(null, INVALID_REQUEST, "Invalid Request"), calls: [] };

  const calls: RpcOutcome["calls"] = [];
  const responses: RpcResponse[] = [];
  let invalid = false;
  let toolCalls = 0;
  for (const raw of raws) {
    const message = classify(raw);
    if (message.kind === "invalid") {
      invalid = true;
      responses.push(errorResponse(message.id, INVALID_REQUEST, "Invalid Request"));
    } else if (message.kind === "request" && message.method === "tools/call" && ++toolCalls > MAX_TOOL_CALLS_PER_BATCH) {
      calls.push({ method: message.method });
      responses.push(errorResponse(message.id, INVALID_REQUEST, "Too many tool calls in one batch"));
    } else if (message.kind === "request") {
      const params = message.params;
      const tool = message.method === "tools/call" && isObject(params) && typeof params.name === "string" ? params.name : undefined;
      calls.push(tool === undefined ? { method: message.method } : { method: message.method, tool });
      responses.push(await answer(message, methods));
    } else if (message.kind === "notification") {
      calls.push({ method: (raw as { method: string }).method });
    }
  }
  if (responses.length === 0) return { status: 202, body: null, calls };
  // A single message that is not JSON-RPC at all: the body as a whole is refused.
  return { status: !batch && invalid ? 400 : 200, body: batch ? responses : responses[0]!, calls };
}

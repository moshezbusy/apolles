import http from "node:http";
import { pathToFileURL } from "node:url";
import { createApollesClient, TokenRejected } from "./apolles-client";
import { loadConfig, type McpConfig } from "./config";
import { handleRpc, SUPPORTED_VERSIONS, type RpcOutcome } from "./protocol";
import { callTool, listTools, TOOL_NAMES } from "./tools";

// The search-only MCP server (plan 11, task 8; design §4.3 and §5): a separate process with no
// database and no supplier access. It answers MCP over Streamable HTTP, stateless (JSON
// answers only: no sessions, no SSE stream), and forwards each tool call, with the agent's own
// token, to the Apolles AI API. Run with
//   node --import ./prisma/ts-loader.mjs src/mcp/server.ts
// It stops on SIGTERM/SIGINT after the requests in hand are answered.

const MCP_PATH = "/mcp";
const PRM_PATHS = ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"];
const ALLOWED_ORIGINS = new Set(["https://claude.ai", "https://chatgpt.com"]);
const MAX_BODY_BYTES = 64 * 1024;
const SCOPE = "search:read";
// Names the log may repeat; anything else the client sent is logged as "other".
const KNOWN_METHODS = new Set(["initialize", "ping", "tools/list", "tools/call", "notifications/initialized", "notifications/cancelled"]);

type Answer = { status: number; headers?: Record<string, string>; json?: unknown; label?: string };

function bearerOf(header: string | undefined): string | null {
  const match = header?.match(/^Bearer +(\S+)$/i);
  return match ? match[1]! : null;
}

// The body, up to the cap. "too_large" as soon as more arrives (declared or counted).
function readBody(req: http.IncomingMessage): Promise<string | "too_large" | "unreadable"> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return Promise.resolve("too_large");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: string | "too_large" | "unreadable") => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        finish("too_large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        finish(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        finish("unreadable");
      }
    });
    req.on("error", () => finish("unreadable"));
  });
}

function logLabel(calls: RpcOutcome["calls"]): string {
  if (calls.length === 0) return "";
  return calls
    .slice(0, 10)
    .map((c) => {
      const method = KNOWN_METHODS.has(c.method) ? c.method : "other";
      if (c.tool === undefined) return method;
      return `${method} ${(TOOL_NAMES as readonly string[]).includes(c.tool) ? c.tool : "other"}`;
    })
    .join(",");
}

export function createMcpServer(cfg: McpConfig, fetchFn: typeof fetch = fetch): http.Server {
  const publicUrl = cfg.publicUrl.replace(/\/+$/, "");
  const metadata = {
    resource: `${publicUrl}${MCP_PATH}`,
    // R3: exactly the app's issuer string.
    authorization_servers: [cfg.authServer.replace(/\/+$/, "")],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
  // Tells the assistant where to sign in (RFC 9728 §5.1).
  const challenge = { "WWW-Authenticate": `Bearer resource_metadata="${publicUrl}${PRM_PATHS[0]}", scope="${SCOPE}"` };
  const unauthorized: Answer = { status: 401, headers: challenge, json: { error: "unauthorized" } };
  const client = createApollesClient(cfg, fetchFn);

  async function handleMcp(req: http.IncomingMessage): Promise<Answer> {
    if (req.method !== "POST") return { status: 405, headers: { Allow: "POST" } };
    const version = req.headers["mcp-protocol-version"];
    if (version !== undefined && !(SUPPORTED_VERSIONS as readonly string[]).includes(String(version))) {
      return { status: 400, json: { error: "unsupported_protocol_version" } };
    }
    // Every POST needs a token: this is how an assistant finds out where to sign in.
    const token = bearerOf(req.headers.authorization);
    if (token === null) return unauthorized;

    const body = await readBody(req);
    if (body === "too_large") return { status: 413, headers: { Connection: "close" }, json: { error: "too_large" } };
    if (body === "unreadable") return { status: 400, json: { error: "unreadable_body" } };

    let outcome: RpcOutcome;
    try {
      outcome = await handleRpc(body, {
        listTools,
        callTool: (name, args) => callTool(name, args, (path, apiBody) => client.post(path, token, apiBody)),
      });
    } catch (error) {
      if (error instanceof TokenRejected) return { ...unauthorized, label: "tools/call" };
      throw error;
    }
    const label = logLabel(outcome.calls);
    if (outcome.body === null) return { status: outcome.status, label };
    return { status: outcome.status, json: outcome.body, label };
  }

  async function route(req: http.IncomingMessage): Promise<Answer> {
    // A browser page on another site must not drive this server with an agent's token.
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) return { status: 403 };
    const path = (req.url ?? "").split("?")[0];
    if (path === MCP_PATH) return handleMcp(req);
    if (path !== undefined && PRM_PATHS.includes(path)) {
      if (req.method !== "GET") return { status: 405, headers: { Allow: "GET" } };
      return { status: 200, json: metadata };
    }
    return { status: 404 };
  }

  return http.createServer({ requestTimeout: 30_000 }, (req, res) => {
    const started = Date.now();
    const path = (req.url ?? "").split("?")[0] ?? "";
    const where = path === MCP_PATH || PRM_PATHS.includes(path) ? path : "other";
    const method = ["GET", "POST", "DELETE", "PUT", "PATCH", "HEAD", "OPTIONS"].includes(req.method ?? "") ? req.method : "OTHER";

    const send = (answer: Answer) => {
      const headers: Record<string, string> = { "Cache-Control": "no-store", ...answer.headers };
      let payload: string | undefined;
      if (answer.json !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(answer.json);
      }
      res.writeHead(answer.status, headers);
      res.end(payload);
      // Never headers, tokens, arguments or answers: only what was asked and how it went.
      const label = answer.label ? ` ${answer.label}` : "";
      console.info(`mcp ${method} ${where}${label} ${answer.status} ${Date.now() - started}ms`);
    };

    route(req)
      .catch((error: unknown): Answer => {
        console.error(`mcp request failed: ${error instanceof Error ? error.name : "Error"}`);
        return { status: 500, json: { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } } };
      })
      .then(send)
      .catch(() => res.destroy());
  });
}

// ---------- the process ----------

function main(): void {
  const cfg = loadConfig();
  const server = createMcpServer(cfg);
  server.listen(cfg.port, () => console.info(`Apolles MCP server listening on port ${cfg.port}.`));
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      console.info("Apolles MCP server stopping.");
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      // Requests in hand get up to the API timeout and a little more.
      setTimeout(() => process.exit(1), 15_000).unref();
    });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // The config error names the variable only, never its value.
    console.error(`Refusing to start: ${error instanceof Error ? error.message : "bad configuration"}`);
    process.exit(1);
  }
}

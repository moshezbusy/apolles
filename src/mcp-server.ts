// The Apolles MCP connector (plan 2026-11-22-mcp-search-connector): a separate process from the
// app, in its own container, that Claude and ChatGPT connect to. Search only, two tools; see
// src/mcp/server.ts. It reads only MCP_PUBLIC_URL, APP_URL, APP_INTERNAL_URL (and NODE_ENV,
// APP_ENV) and refuses to start if a database address or any key is in its environment.
// Run: node --import ./prisma/ts-loader.mjs src/mcp-server.ts   (listens on port 3100)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "./mcp/server";
import { mcpConfigFrom, startupProblems } from "./mcp/startup";

const PORT = 3100;
const MAX_BODY_BYTES = 64 * 1024;
const VERSION = "1.0.0";

const problems = startupProblems(process.env);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
const handle = createMcpHandler(mcpConfigFrom(process.env, VERSION));
const publicOrigin = new URL(process.env.MCP_PUBLIC_URL ?? "").origin;

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = req.method === "POST" ? await readBody(req) : Buffer.alloc(0);
  if (body === null) {
    res.writeHead(413).end();
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  // The address is the public one: the proxy in front decides the host, never the client.
  const request = new Request(new URL(req.url ?? "/", publicOrigin), { method: req.method ?? "GET", headers, ...(req.method === "POST" ? { body: new Uint8Array(body) } : {}) });
  const started = Date.now();
  const response = await handle(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
  // One line per request: never a token, an argument or an address.
  console.info(`mcp ${req.method} ${new URL(request.url).pathname} ${response.status} ${Date.now() - started}ms`);
}

const server = createServer((req, res) => {
  serve(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.requestTimeout = 120_000;
server.headersTimeout = 20_000;
server.listen(PORT, () => console.info(`Apolles MCP connector listening on ${PORT}.`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

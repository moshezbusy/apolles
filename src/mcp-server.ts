// The search-only MCP server for AI assistants (Claude, ChatGPT): a separate process from the
// app, like the worker. It needs only three settings and no secrets:
//   ASSISTANT_MCP_URL  its public URL (e.g. https://mcp.apolles.com/mcp)
//   APP_URL            the app's public URL (the OAuth sign-in)
//   APP_INTERNAL_URL   how it reaches the app on the private network (e.g. http://apolles-staging:3000)
// It must NOT be given DATABASE_URL or any supplier key. Run:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./prisma/ts-loader.mjs src/mcp-server.ts
import { createMcpServer, readMcpConfig } from "./mcp/server";

const config = readMcpConfig();
if (!config) {
  console.error("Refusing to start: set ASSISTANT_MCP_URL and APP_URL (https) and APP_INTERNAL_URL.");
  process.exit(1);
}
if (process.env.DATABASE_URL) {
  console.error("Refusing to start: the MCP server must not have DATABASE_URL.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? "3100");
const server = createMcpServer(config);
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(port, "0.0.0.0", () => console.info(`Apolles MCP server listening on ${port}.`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

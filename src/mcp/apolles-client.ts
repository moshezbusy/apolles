import type { McpConfig } from "./config";

// The MCP server's only way into Apolles: the internal AI API over HTTP (design §4.3). The
// agent's token goes only to Apolles, the server that issued it, together with this server's
// own service key; Apolles checks both and answers the search in the same call.

const TIMEOUT_MS = 10_000;

export type ApiPath = "search" | "rates";

// `answer`: Apolles answered (any status but 401), with its JSON body or null if it had none.
// `unavailable`: no answer at all (timeout, network failure).
export type ApiAnswer = { kind: "answer"; status: number; json: unknown } | { kind: "unavailable" };

// Apolles refused the agent's token (revoked, expired, wrong audience): the HTTP layer answers
// 401 so the assistant signs in again.
export class TokenRejected extends Error {
  constructor() {
    super("token rejected");
    this.name = "TokenRejected";
  }
}

export type ApollesClient = { post(path: ApiPath, token: string, body: Record<string, unknown>): Promise<ApiAnswer> };

export function createApollesClient(cfg: Pick<McpConfig, "internalUrl" | "serviceKey">, fetchFn: typeof fetch = fetch): ApollesClient {
  const base = cfg.internalUrl.replace(/\/+$/, "");
  return {
    async post(path, token, body) {
      let res: Response;
      let text: string;
      try {
        res = await fetchFn(`${base}/api/ai/v1/${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "X-Apolles-Service-Key": cfg.serviceKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          // A redirect would carry the service key to another address: never followed.
          redirect: "error",
          // Covers the whole exchange, body included.
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        text = await res.text();
      } catch {
        return { kind: "unavailable" };
      }
      if (res.status === 401) throw new TokenRejected();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { kind: "answer", status: res.status, json };
    },
  };
}

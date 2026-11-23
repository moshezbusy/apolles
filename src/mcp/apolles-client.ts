import type { McpConfig } from "./config";

// The MCP server's only way into Apolles: the internal AI API over HTTP (design §4.3). The
// agent's token goes only to Apolles, the server that issued it, together with this server's
// own service key; Apolles checks both and answers the search in the same call.

const TIMEOUT_MS = 10_000;

export type ApiPath = "search" | "rates";

// `answer`: Apolles answered, with its JSON body or null if it had none (never the 401 that
// refuses the token: that is TokenRejected).
// `unavailable`: no answer at all (timeout, network failure), or a 401 for anything else than the
// agent's token (a wrong service key is a setup fault here: signing in again would not help).
export type ApiAnswer = { kind: "answer"; status: number; json: unknown } | { kind: "unavailable" };

// Apolles refused the agent's token (revoked, expired, wrong audience): the HTTP layer answers
// 401 so the assistant signs in again.
export class TokenRejected extends Error {
  constructor() {
    super("token rejected");
    this.name = "TokenRejected";
  }
}

// `clientIp`: the assistant's address (one IP literal, see clientIpOf in server.ts), sent on so
// the app's per-IP limits count each caller apart; the app trusts it only with the service key.
export type ApollesClient = {
  post(path: ApiPath, token: string, body: Record<string, unknown>, clientIp?: string | null): Promise<ApiAnswer>;
};

export function createApollesClient(cfg: Pick<McpConfig, "internalUrl" | "serviceKey">, fetchFn: typeof fetch = fetch): ApollesClient {
  const base = cfg.internalUrl.replace(/\/+$/, "");
  return {
    async post(path, token, body, clientIp) {
      let res: Response;
      let text: string;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "X-Apolles-Service-Key": cfg.serviceKey, "Content-Type": "application/json" };
      if (clientIp) headers["X-Apolles-Client-Ip"] = clientIp;
      try {
        res = await fetchFn(`${base}/api/ai/v1/${path}`, {
          method: "POST",
          headers,
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
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.status === 401) {
        const said = json !== null && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
        if (said === "invalid_token") throw new TokenRejected();
        return { kind: "unavailable" };
      }
      return { kind: "answer", status: res.status, json };
    },
  };
}

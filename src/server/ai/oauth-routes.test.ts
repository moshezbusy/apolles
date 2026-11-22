import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { issueAuthCode, revokeByToken, verifyAiToken } from "@/server/ai/tokens";
import * as metadataRoute from "@/app/.well-known/oauth-authorization-server/route";
import * as tokenRoute from "@/app/oauth/token/route";
import * as revokeRoute from "@/app/oauth/revoke/route";

const ISSUER = "https://app.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_CIMD = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const IP = "203.0.113.7";
const FIFTEEN_MIN = 15 * 60 * 1000;

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function createAgent() {
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
  const user = await createUser({ email: "agent@example.com", name: "Agent", role: "AGENT", agencyId: agency.id });
  return { userId: user.id, agencyId: agency.id };
}

function form(path: string, fields: Record<string, string> | string, headers: Record<string, string> = {}): Request {
  return new Request(`${ISSUER}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": IP, ...headers },
    body: typeof fields === "string" ? fields : new URLSearchParams(fields).toString(),
  });
}

// A Claude client (DCR) and one agent, with a fresh code for them.
async function setup() {
  const agent = await createAgent();
  const client = await db.aiClient.create({ data: { name: "Claude", redirectUris: [REDIRECT] } });
  const { verifier, challenge } = pkce();
  const code = await issueAuthCode({
    userId: agent.userId,
    clientId: client.id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    resource: RESOURCE,
  });
  const codeGrant = {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: client.id,
    code_verifier: verifier,
    resource: RESOURCE,
  };
  return { agent, client, codeGrant };
}

async function tokens(fields: Record<string, string>) {
  const res = await tokenRoute.POST(form("/oauth/token", fields));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

// A copy of `fields` without `key`.
function without<T extends Record<string, string>>(fields: T, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => k !== key));
}

beforeEach(async () => {
  await resetTestDb();
  vi.stubEnv("AI_SEARCH_ENABLED", "true");
  vi.stubEnv("APP_URL", `${ISSUER}/`);
  vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("feature switch", () => {
  it("off → every method of every new route answers 404, OPTIONS included", async () => {
    vi.stubEnv("AI_SEARCH_ENABLED", "false");
    const handlers = [
      ...Object.values(metadataRoute),
      ...Object.values(tokenRoute),
      ...Object.values(revokeRoute),
    ] as ((request: Request) => Promise<Response>)[];
    expect(handlers.length).toBeGreaterThanOrEqual(15);
    for (const handler of handlers) {
      const res = await handler(form("/oauth/token", { grant_type: "authorization_code" }));
      expect(res.status).toBe(404);
    }
    expect(metadataRoute.OPTIONS).toBeTypeOf("function");
    expect(tokenRoute.OPTIONS).toBeTypeOf("function");
    expect(revokeRoute.OPTIONS).toBeTypeOf("function");
  });

  it("on → the wrong methods answer 405 with Allow", async () => {
    for (const [handler, allow] of [
      [metadataRoute.POST, "GET"],
      [metadataRoute.OPTIONS, "GET"],
      [tokenRoute.GET, "POST"],
      [tokenRoute.OPTIONS, "POST"],
      [revokeRoute.GET, "POST"],
      [revokeRoute.OPTIONS, "POST"],
    ] as const) {
      const res = await (handler as (request: Request) => Promise<Response>)(new Request(`${ISSUER}/x`));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe(allow);
    }
  });
});

describe("GET /.well-known/oauth-authorization-server", () => {
  it("describes the authorization server, with the issuer from APP_URL", async () => {
    const res = await metadataRoute.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`,
      scopes_supported: ["search:read", "offline_access"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("POST /oauth/token", () => {
  it("authorization_code → a token pair, never cached", async () => {
    const { codeGrant, agent } = await setup();
    const { res, body } = await tokens(codeGrant);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(Object.keys(body).sort()).toEqual(["access_token", "expires_in", "refresh_token", "scope", "token_type"]);
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "search:read" });
    expect(await verifyAiToken(body.access_token as string, RESOURCE)).toMatchObject({ userId: agent.userId });
  });

  it("accepts the scopes it supports on the code grant, and the code is single use", async () => {
    const { codeGrant } = await setup();
    const first = await tokens({ ...codeGrant, scope: "search:read offline_access" });
    expect(first.res.status).toBe(200);
    const again = await tokens(codeGrant);
    expect(again.res.status).toBe(400);
    expect(again.body).toEqual({ error: "invalid_grant" });
  });

  it("a CIMD client is named by its URL, and its cached row is used without fetching", async () => {
    const agent = await createAgent();
    const client = await db.aiClient.create({ data: { clientIdUrl: CLAUDE_CIMD, name: "Claude", redirectUris: [REDIRECT] } });
    const { verifier, challenge } = pkce();
    const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { res } = await tokens({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: CLAUDE_CIMD,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    // The internal row id of a CIMD client is not a client_id.
    const { codeGrant } = { codeGrant: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.id, code_verifier: verifier, resource: RESOURCE } };
    expect((await tokens(codeGrant)).res.status).toBe(401);
  });

  it("refresh_token → a new pair; the old refresh token then revokes the connection", async () => {
    const { codeGrant, client } = await setup();
    const first = (await tokens(codeGrant)).body;
    const next = await tokens({ grant_type: "refresh_token", refresh_token: first.refresh_token as string, client_id: client.id, resource: RESOURCE });
    expect(next.res.status).toBe(200);
    expect(next.body.refresh_token).not.toBe(first.refresh_token);
    const withScope = await tokens({
      grant_type: "refresh_token",
      refresh_token: next.body.refresh_token as string,
      client_id: client.id,
      resource: RESOURCE,
      scope: "search:read",
    });
    expect(withScope.res.status).toBe(200);
    const reuse = await tokens({ grant_type: "refresh_token", refresh_token: first.refresh_token as string, client_id: client.id, resource: RESOURCE });
    expect(reuse.body).toEqual({ error: "invalid_grant" });
    expect(await verifyAiToken(withScope.body.access_token as string, RESOURCE)).toBeNull();
  });

  it("refuses grants other than the two", async () => {
    const { client } = await setup();
    for (const grant of ["password", "client_credentials", "urn:ietf:params:oauth:grant-type:device_code"]) {
      const { res, body } = await tokens({ grant_type: grant, client_id: client.id });
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "unsupported_grant_type" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("any scope beyond search:read and offline_access → invalid_scope, no tokens", async () => {
    const { codeGrant, client } = await setup();
    for (const scope of ["search:write", "search:read search:write", "openid"]) {
      const { res, body } = await tokens({ ...codeGrant, scope });
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "invalid_scope" });
    }
    const refreshTry = await tokens({ grant_type: "refresh_token", refresh_token: "x".repeat(43), client_id: client.id, resource: RESOURCE, scope: "search:write" });
    expect(refreshTry.body).toEqual({ error: "invalid_scope" });
    expect(await db.aiConnection.count()).toBe(0);
  });

  it("the resource must be the MCP server: missing or another → invalid_target", async () => {
    const { codeGrant } = await setup();
    const withoutResource = without(codeGrant, "resource");
    for (const fields of [withoutResource, { ...codeGrant, resource: "https://evil.example/mcp" }]) {
      const { res, body } = await tokens(fields);
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "invalid_target" });
    }
  });

  it("unknown client → 401 invalid_client; missing client_id → invalid_request", async () => {
    const { codeGrant } = await setup();
    const unknown = await tokens({ ...codeGrant, client_id: "nope" });
    expect(unknown.res.status).toBe(401);
    expect(unknown.body).toEqual({ error: "invalid_client" });
    const withoutClient = without(codeGrant, "client_id");
    const missing = await tokens(withoutClient);
    expect(missing.res.status).toBe(400);
    expect(missing.body).toEqual({ error: "invalid_request" });
  });

  it("a wrong verifier or redirect → invalid_grant", async () => {
    const { codeGrant } = await setup();
    expect((await tokens({ ...codeGrant, code_verifier: pkce().verifier })).body).toEqual({ error: "invalid_grant" });
    expect((await tokens({ ...codeGrant, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" })).body).toEqual({ error: "invalid_grant" });
  });

  it("form-encoded only, no unknown or repeated fields, body at most 8 KB", async () => {
    const { codeGrant } = await setup();
    const json = await tokenRoute.POST(
      new Request(`${ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": IP },
        body: JSON.stringify(codeGrant),
      }),
    );
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: "invalid_request" });
    expect((await tokens({ ...codeGrant, extra: "1" })).body).toEqual({ error: "invalid_request" });
    const repeated = `${new URLSearchParams(codeGrant).toString()}&client_id=other`;
    const rep = await tokenRoute.POST(form("/oauth/token", repeated));
    expect(await rep.json()).toEqual({ error: "invalid_request" });
    expect((await tokens({ ...codeGrant, ["__proto__"]: "x" })).body).toEqual({ error: "invalid_request" });
    const big = await tokenRoute.POST(form("/oauth/token", { ...codeGrant, pad: "a".repeat(9 * 1024) }));
    expect(big.status).toBe(400);
    expect(await big.json()).toEqual({ error: "invalid_request" });
    // None of these spent the code.
    expect((await tokens(codeGrant)).res.status).toBe(200);
  });

  describe("rate limits", () => {
    it("DCR client: the 61st request in 15 minutes → 429", async () => {
      const { codeGrant, client } = await setup();
      await seedRateLimit(`ai-token:client:${client.id}`, 60, FIFTEEN_MIN);
      const { res, body } = await tokens(codeGrant);
      expect(res.status).toBe(429);
      expect(body).toEqual({ error: "too_many_requests" });
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    });

    it("DCR client: the 60th still goes through", async () => {
      const { codeGrant, client } = await setup();
      await seedRateLimit(`ai-token:client:${client.id}`, 59, FIFTEEN_MIN);
      expect((await tokens(codeGrant)).res.status).toBe(200);
    });

    // Every Claude user sends the same CIMD client_id: one bucket for it would let one
    // connection (or anyone) use up every other agent's refreshes.
    it("CIMD client: 61 refreshes of one connection from many IPs → only that connection is stopped", async () => {
      const agent = await createAgent();
      const client = await db.aiClient.create({ data: { clientIdUrl: CLAUDE_CIMD, name: "Claude", redirectUris: [REDIRECT] } });
      async function connectCimd(): Promise<string> {
        const { verifier, challenge } = pkce();
        const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
        const body = (await tokens({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE_CIMD, code_verifier: verifier, resource: RESOURCE })).body;
        return body.refresh_token as string;
      }
      let refreshA = await connectCimd();
      const refreshB = await connectCimd();
      const refreshFrom = async (token: string, n: number) =>
        tokenRoute.POST(
          form(
            "/oauth/token",
            { grant_type: "refresh_token", refresh_token: token, client_id: CLAUDE_CIMD, resource: RESOURCE },
            { "x-forwarded-for": `198.51.100.${(n % 250) + 1}` },
          ),
        );
      for (let n = 1; n <= 60; n += 1) {
        const res = await refreshFrom(refreshA, n);
        expect(res.status, `refresh ${n}`).toBe(200);
        refreshA = ((await res.json()) as { refresh_token: string }).refresh_token;
      }
      expect((await refreshFrom(refreshA, 61)).status).toBe(429);
      expect((await refreshFrom(refreshB, 62)).status).toBe(200);
      const keys = (await db.rateLimitBucket.findMany({ select: { key: true } })).map((r) => r.key);
      expect(keys.some((k) => k.startsWith("ai-token:client:"))).toBe(false);
    });

    it("refresh: the 61st of one connection → 429 (other limits not reached)", async () => {
      const { codeGrant, client } = await setup();
      const pair = (await tokens(codeGrant)).body;
      const connection = await db.aiConnection.findFirstOrThrow();
      await seedRateLimit(`ai-token:connection:${connection.id}`, 60, FIFTEEN_MIN);
      const { res } = await tokens({ grant_type: "refresh_token", refresh_token: pair.refresh_token as string, client_id: client.id, resource: RESOURCE });
      expect(res.status).toBe(429);
      // Refused before the refresh: the token is still unused and works later.
      expect((await db.aiToken.findFirstOrThrow()).usedAt).toBeNull();
    });

    it("the 2,001st request from one IP in 15 minutes → 429", async () => {
      const { codeGrant } = await setup();
      await seedRateLimit(`ai-token:ip:${IP}`, 2000, FIFTEEN_MIN);
      expect((await tokens(codeGrant)).res.status).toBe(429);
    });
  });
});

describe("POST /oauth/revoke", () => {
  async function connected() {
    const s = await setup();
    const pair = (await tokens(s.codeGrant)).body as { access_token: string; refresh_token: string };
    return { ...s, pair };
  }

  async function revoke(fields: Record<string, string>) {
    return revokeRoute.POST(form("/oauth/revoke", fields));
  }

  it("the client revokes with its access token → 200, the whole connection ends, audit row", async () => {
    const { client, pair, agent } = await connected();
    const res = await revoke({ token: pair.access_token, token_type_hint: "access_token", client_id: client.id });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const connection = await db.aiConnection.findFirstOrThrow();
    expect(connection.revokedReason).toBe("client_revoke");
    expect(connection.revokedAt).not.toBeNull();
    expect(await db.aiToken.count()).toBe(0);
    expect(await verifyAiToken(pair.access_token, RESOURCE)).toBeNull();
    const rows = await db.auditLog.findMany({ where: { action: "ai.revoke" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: agent.userId, targetType: "AiConnection", targetId: connection.id, after: { reason: "client_revoke" } });
  });

  it("works with the refresh token too", async () => {
    const { client, pair } = await connected();
    expect((await revoke({ token: pair.refresh_token, client_id: client.id })).status).toBe(200);
    expect((await db.aiConnection.findFirstOrThrow()).revokedReason).toBe("client_revoke");
  });

  it("another client's token, an unknown token: 200 and nothing changes (no oracle)", async () => {
    const { pair } = await connected();
    const other = await db.aiClient.create({ data: { name: "Claude", redirectUris: [REDIRECT] } });
    expect((await revoke({ token: pair.access_token, client_id: other.id })).status).toBe(200);
    expect((await revoke({ token: "x".repeat(43), client_id: other.id })).status).toBe(200);
    expect((await db.aiConnection.findFirstOrThrow()).revokedAt).toBeNull();
    expect(await verifyAiToken(pair.access_token, RESOURCE)).not.toBeNull();
  });

  it("revokeByToken matches a CIMD client by its URL", async () => {
    const agent = await createAgent();
    const client = await db.aiClient.create({ data: { clientIdUrl: CLAUDE_CIMD, name: "Claude", redirectUris: [REDIRECT] } });
    const { verifier, challenge } = pkce();
    const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
    const pair = (await tokens({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE_CIMD, code_verifier: verifier, resource: RESOURCE })).body;
    await revokeByToken(pair.access_token as string, client.id);
    expect((await db.aiConnection.findFirstOrThrow()).revokedAt).toBeNull();
    await revokeByToken(pair.access_token as string, CLAUDE_CIMD);
    expect((await db.aiConnection.findFirstOrThrow()).revokedReason).toBe("client_revoke");
  });

  it("a malformed request → 400 invalid_request", async () => {
    const { client } = await connected();
    expect((await revoke({ client_id: client.id })).status).toBe(400);
    expect((await revoke({ token: "abc", client_id: client.id, extra: "1" })).status).toBe(400);
  });

  it("the 121st revoke from one IP in 15 minutes → 429", async () => {
    const { client, pair } = await connected();
    await seedRateLimit(`ai-revoke:ip:${IP}`, 120, FIFTEEN_MIN);
    expect((await revoke({ token: pair.access_token, client_id: client.id })).status).toBe(429);
    expect((await db.aiConnection.findFirstOrThrow()).revokedAt).toBeNull();
  });
});

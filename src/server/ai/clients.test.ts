import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { assistantName, registerClient, resolveClient } from "@/server/ai/clients";
import { GET, POST } from "@/app/oauth/register/route";

const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const CHATGPT_CALLBACK = "https://chatgpt.com/connector/oauth/abc_DEF-123";
const CLAUDE_CIMD = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CHATGPT_CIMD = "https://chatgpt.com/oauth/client.json";
const CHATGPT_CIMD_PER_CONNECTOR = "https://chatgpt.com/oauth/cb_123-x/client.json";
const IP = "203.0.113.7";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type FetchFn = typeof fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fetchReturning(make: () => Response | Promise<Response>) {
  return vi.fn<FetchFn>(async () => make());
}

function claudeDoc(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLAUDE_CIMD,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CLAUDE_REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...overrides,
  };
}

function registerRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.test/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": IP, ...headers },
    body,
  });
}

describe("assistantName", () => {
  it("names the assistant only for redirect URIs on the allowlist", () => {
    expect(assistantName(CLAUDE_REDIRECT)).toBe("Claude");
    expect(assistantName(CHATGPT_REDIRECT)).toBe("ChatGPT");
    expect(assistantName(CHATGPT_CALLBACK)).toBe("ChatGPT");
    expect(assistantName(`${CLAUDE_REDIRECT}/`)).toBeNull();
    expect(assistantName(`${CLAUDE_REDIRECT}?x=1`)).toBeNull();
    expect(assistantName("http://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(assistantName("http://localhost:3000/callback")).toBeNull();
    expect(assistantName("https://chatgpt.com/connector/oauth/a.b")).toBeNull();
    expect(assistantName("https://chatgpt.com/connector/oauth/")).toBeNull();
    expect(assistantName(`https://chatgpt.com/connector/oauth/${"a".repeat(129)}`)).toBeNull();
    expect(assistantName(`https://chatgpt.com/connector/oauth/${"a".repeat(128)}`)).toBe("ChatGPT");
  });
});

describe("registerClient (DCR)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("registers a Claude client named by its redirect URI, never by client_name", async () => {
    const result = await registerClient(
      {
        redirect_uris: [CLAUDE_REDIRECT],
        client_name: "Totally ChatGPT",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "search:read offline_access",
        client_uri: "https://claude.ai",
        software_id: "claude",
      },
      IP,
    );

    expect(result.status).toBe(201);
    const json = result.json as Record<string, unknown>;
    expect(json).toEqual({
      client_id: expect.any(String),
      client_id_issued_at: expect.any(Number),
      redirect_uris: [CLAUDE_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    const row = await db.aiClient.findUniqueOrThrow({ where: { id: json.client_id as string } });
    expect(row).toMatchObject({ name: "Claude", clientIdUrl: null, redirectUris: [CLAUDE_REDIRECT] });
  });

  it("registers a ChatGPT client with a per-connector callback", async () => {
    const result = await registerClient({ redirect_uris: [CHATGPT_CALLBACK] }, IP);
    expect(result.status).toBe(201);
    const row = await db.aiClient.findFirstOrThrow();
    expect(row.name).toBe("ChatGPT");
  });

  it("refuses a redirect URI off the allowlist with invalid_redirect_uri", async () => {
    for (const uri of ["https://evil.example/callback", "http://localhost:3000/callback", `${CLAUDE_REDIRECT}?x=1`]) {
      const result = await registerClient({ redirect_uris: [CLAUDE_REDIRECT, uri] }, IP);
      expect(result).toEqual({ status: 400, json: expect.objectContaining({ error: "invalid_redirect_uri" }) });
    }
    expect(await db.aiClient.count()).toBe(0);
  });

  it("refuses Claude and ChatGPT redirect URIs in one registration", async () => {
    const result = await registerClient({ redirect_uris: [CLAUDE_REDIRECT, CHATGPT_REDIRECT] }, IP);
    expect(result).toEqual({ status: 400, json: expect.objectContaining({ error: "invalid_redirect_uri" }) });
    expect(await db.aiClient.count()).toBe(0);
  });

  it("refuses token_endpoint_auth_method other than none", async () => {
    for (const method of ["client_secret_basic", "client_secret_post", "private_key_jwt"]) {
      const result = await registerClient({ redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: method }, IP);
      expect(result).toEqual({ status: 400, json: expect.objectContaining({ error: "invalid_client_metadata" }) });
    }
    expect(await db.aiClient.count()).toBe(0);
  });

  it("refuses unknown fields", async () => {
    const result = await registerClient({ redirect_uris: [CLAUDE_REDIRECT], jwks_uri: "https://evil.example/jwks" }, IP);
    expect(result).toEqual({ status: 400, json: expect.objectContaining({ error: "invalid_client_metadata" }) });
    expect(await db.aiClient.count()).toBe(0);
  });

  it("refuses other scopes, grant types and response types, and a missing or empty redirect list", async () => {
    const bodies: unknown[] = [
      { redirect_uris: [CLAUDE_REDIRECT], scope: "search:read search:write" },
      { redirect_uris: [CLAUDE_REDIRECT], grant_types: ["client_credentials"] },
      { redirect_uris: [CLAUDE_REDIRECT], response_types: ["token"] },
      { redirect_uris: [] },
      { redirect_uris: Array.from({ length: 6 }, () => CLAUDE_REDIRECT) },
      { client_name: "Claude" },
      undefined,
      "not an object",
    ];
    for (const body of bodies) {
      const result = await registerClient(body, IP);
      expect(result).toEqual({ status: 400, json: expect.objectContaining({ error: "invalid_client_metadata" }) });
    }
    expect(await db.aiClient.count()).toBe(0);
  });

  it("answers 429 to the 101st registration in an hour from one IP, even for an invalid body", async () => {
    await seedRateLimit(`ai-register:ip:${IP}`, 100, HOUR);

    const refused = await registerClient({ redirect_uris: [CLAUDE_REDIRECT] }, IP);
    expect(refused.status).toBe(429);
    const refusedInvalid = await registerClient(undefined, IP);
    expect(refusedInvalid.status).toBe(429);
    expect(await db.aiClient.count()).toBe(0);

    const otherIp = await registerClient({ redirect_uris: [CLAUDE_REDIRECT] }, "198.51.100.1");
    expect(otherIp.status).toBe(201);
  });

  it("counts invalid requests too", async () => {
    await seedRateLimit(`ai-register:ip:${IP}`, 99, HOUR);
    expect((await registerClient({ bogus: true }, IP)).status).toBe(400);
    expect((await registerClient({ redirect_uris: [CLAUDE_REDIRECT] }, IP)).status).toBe(429);
  });
});

describe("resolveClient", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns null for a URL off the CIMD allowlist without fetching", async () => {
    const fetchSpy = fetchReturning(() => jsonResponse(claudeDoc()));
    for (const url of [
      "https://evil.example/client.json",
      "https://claude.ai/oauth/claude-code-client-metadata",
      "http://chatgpt.com/oauth/client.json",
      `${CLAUDE_CIMD}?x=1`,
      "https://chatgpt.com/oauth/a.b/client.json",
      "https://chatgpt.com/oauth/a/b/client.json",
      "https://chatgpt.com.evil.example/oauth/x/client.json",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(await resolveClient(url, fetchSpy)).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches an allowlisted CIMD document without following redirects, with a timeout, and caches it", async () => {
    const fetchSpy = fetchReturning(() => jsonResponse(claudeDoc()));

    const client = await resolveClient(CLAUDE_CIMD, fetchSpy);
    expect(client).toMatchObject({ clientIdUrl: CLAUDE_CIMD, name: "Claude", redirectUris: [CLAUDE_REDIRECT] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(CLAUDE_CIMD);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);

    const again = await resolveClient(CLAUDE_CIMD, fetchSpy);
    expect(again?.id).toBe(client!.id);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await db.aiClient.count()).toBe(1);
  });

  it("accepts ChatGPT's CIMD documents (stable and per connector)", async () => {
    const stable = await resolveClient(
      CHATGPT_CIMD,
      fetchReturning(() => jsonResponse({ client_id: CHATGPT_CIMD, redirect_uris: [CHATGPT_REDIRECT] })),
    );
    expect(stable).toMatchObject({ name: "ChatGPT", redirectUris: [CHATGPT_REDIRECT] });

    const perConnector = await resolveClient(
      CHATGPT_CIMD_PER_CONNECTOR,
      fetchReturning(() =>
        jsonResponse({ client_id: CHATGPT_CIMD_PER_CONNECTOR, redirect_uris: [CHATGPT_CALLBACK], extra_field: 1 }),
      ),
    );
    expect(perConnector).toMatchObject({ name: "ChatGPT", redirectUris: [CHATGPT_CALLBACK] });
  });

  it("returns null when an allowlisted document's redirect_uris leave the allowlist", async () => {
    const fetchSpy = fetchReturning(() =>
      jsonResponse(claudeDoc({ redirect_uris: [CLAUDE_REDIRECT, "https://evil.example/callback"] })),
    );
    expect(await resolveClient(CLAUDE_CIMD, fetchSpy)).toBeNull();
    expect(await db.aiClient.count()).toBe(0);
  });

  it("returns null for a document that names another assistant's redirect URI", async () => {
    const fetchSpy = fetchReturning(() => jsonResponse(claudeDoc({ redirect_uris: [CHATGPT_REDIRECT] })));
    expect(await resolveClient(CLAUDE_CIMD, fetchSpy)).toBeNull();
  });

  it("returns null for a document with a different client_id or a confidential auth method", async () => {
    expect(
      await resolveClient(CLAUDE_CIMD, fetchReturning(() => jsonResponse(claudeDoc({ client_id: CHATGPT_CIMD })))),
    ).toBeNull();
    expect(
      await resolveClient(
        CLAUDE_CIMD,
        fetchReturning(() => jsonResponse(claudeDoc({ token_endpoint_auth_method: "private_key_jwt" }))),
      ),
    ).toBeNull();
    expect(await db.aiClient.count()).toBe(0);
  });

  it("treats a redirect, an error status, bad JSON, a thrown fetch and an oversized body as failure", async () => {
    const failures: Array<() => Response | Promise<Response>> = [
      () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
      () => new Response("nope", { status: 500 }),
      () => new Response("{not json", { status: 200 }),
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
      () => new Response("x".repeat(64 * 1024 + 1), { status: 200 }),
    ];
    for (const make of failures) {
      expect(await resolveClient(CLAUDE_CIMD, fetchReturning(make))).toBeNull();
    }
    expect(await db.aiClient.count()).toBe(0);
  });

  it("stops reading a body that never ends once it passes 64 KB", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(8 * 1024).fill(32));
      },
    });
    const result = await resolveClient(CLAUDE_CIMD, fetchReturning(() => new Response(endless, { status: 200 })));
    expect(result).toBeNull();
    expect(pulls).toBeLessThan(20);
  });

  it("re-fetches a cached document older than 24 hours and stores the new redirect URIs", async () => {
    await resolveClient(CLAUDE_CIMD, fetchReturning(() => jsonResponse(claudeDoc())));
    const first = await db.aiClient.findUniqueOrThrow({ where: { clientIdUrl: CLAUDE_CIMD } });
    await db.aiClient.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - DAY - 1000) } });

    const fetchSpy = fetchReturning(() => jsonResponse(claudeDoc({ redirect_uris: [CLAUDE_REDIRECT, CLAUDE_REDIRECT] })));
    const refreshed = await resolveClient(CLAUDE_CIMD, fetchSpy);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(refreshed?.id).toBe(first.id);
    expect(refreshed?.redirectUris).toEqual([CLAUDE_REDIRECT]);
    expect(refreshed!.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("keeps using a cached row under 7 days old when the re-fetch fails, not an older one", async () => {
    await resolveClient(CLAUDE_CIMD, fetchReturning(() => jsonResponse(claudeDoc())));
    const row = await db.aiClient.findUniqueOrThrow({ where: { clientIdUrl: CLAUDE_CIMD } });
    const failing = fetchReturning(() => new Response("down", { status: 503 }));

    await db.aiClient.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
    expect((await resolveClient(CLAUDE_CIMD, failing))?.id).toBe(row.id);

    await db.aiClient.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 8 * DAY) } });
    expect(await resolveClient(CLAUDE_CIMD, failing)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("looks up a non-URL client_id as a DCR client, never as a cached CIMD row", async () => {
    const fetchSpy = fetchReturning(() => jsonResponse(claudeDoc()));
    const registered = await registerClient({ redirect_uris: [CLAUDE_REDIRECT] }, IP);
    const clientId = (registered.json as { client_id: string }).client_id;

    expect((await resolveClient(clientId, fetchSpy))?.id).toBe(clientId);
    expect(await resolveClient("unknown-client-id", fetchSpy)).toBeNull();
    expect(await resolveClient("", fetchSpy)).toBeNull();

    const cimd = await resolveClient(CLAUDE_CIMD, fetchSpy);
    expect(await resolveClient(cimd!.id, fetchSpy)).toBeNull();
  });
});

describe("POST /oauth/register", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("AI_SEARCH_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 404 when AI_SEARCH_ENABLED is unset", async () => {
    vi.stubEnv("AI_SEARCH_ENABLED", undefined);
    const res = await POST(registerRequest(JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT] })));
    expect(res.status).toBe(404);
    expect((await GET()).status).toBe(404);
    expect(await db.aiClient.count()).toBe(0);
  });

  it("registers a client: 201, no-store", async () => {
    const res = await POST(registerRequest(JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT] })));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as { client_id: string };
    expect(await db.aiClient.findUnique({ where: { id: json.client_id } })).not.toBeNull();
  });

  it("refuses a body that is not JSON, not application/json, or over 16 KB", async () => {
    const big = JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT], client_name: "x".repeat(16 * 1024) });
    const requests = [
      registerRequest("{not json"),
      registerRequest(JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT] }), { "content-type": "text/plain" }),
      registerRequest(big),
    ];
    for (const request of requests) {
      const res = await POST(request);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect(await db.aiClient.count()).toBe(0);
  });

  it("stops reading a request body that never ends once it passes 16 KB", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4 * 1024).fill(32));
      },
    });
    const request = new Request("https://app.example.test/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-forwarded-for": IP },
      body: endless,
      duplex: "half",
    } as RequestInit);
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(pulls).toBeLessThan(20);
  });

  it("answers 429 with no-store once the IP is over its limit", async () => {
    await seedRateLimit(`ai-register:ip:${IP}`, 100, HOUR);
    const res = await POST(registerRequest(JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT] })));
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 405 to GET when enabled", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

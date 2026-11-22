import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { GET as metadata } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as register } from "@/app/oauth/register/route";
import { POST as token } from "@/app/oauth/token/route";
import { ASSISTANT_CLIENTS } from "./clients";
import { issueAuthCode, parseAuthorizeRequest } from "./oauth";
import { assistantConfig } from "./config";

const CLAUDE = ASSISTANT_CLIENTS.find((c) => c.name === "Claude")!;
const REDIRECT = CLAUDE.redirectUris[0]!;
const MCP = "http://localhost:3100/mcp";

function json(url: string, body: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function form(url: string, fields: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
}

describe("OAuth routes of the assistant connector", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("ASSISTANT_MCP_URL", MCP);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("every route answers 404 while the connector is off", async () => {
    vi.stubEnv("ASSISTANT_MCP_URL", "");
    expect((await metadata()).status).toBe(404);
    expect((await register(json("http://localhost:3000/oauth/register", { redirect_uris: [REDIRECT] }))).status).toBe(404);
    expect((await token(form("http://localhost:3000/oauth/token", { grant_type: "authorization_code" }))).status).toBe(404);
  });

  it("publishes authorization server metadata: code flow, S256, public clients, the search scope only", async () => {
    const res = await metadata();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/oauth/token",
      registration_endpoint: "http://localhost:3000/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["search:read"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("registration gives the fixed public client for known redirect URIs and stores nothing", async () => {
    const res = await register(json("http://localhost:3000/oauth/register", { redirect_uris: [REDIRECT], client_name: "Evil Corp", token_endpoint_auth_method: "client_secret_basic" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ client_id: CLAUDE.clientId, client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    expect(body.client_secret).toBeUndefined();
  });

  it("registration refuses any other redirect URI, bad JSON and oversized bodies", async () => {
    const bad = await register(json("http://localhost:3000/oauth/register", { redirect_uris: ["https://evil.example.com/cb"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_redirect_uri" });
    const garbage = await register(new Request("http://localhost:3000/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    expect(garbage.status).toBe(400);
    const huge = await register(json("http://localhost:3000/oauth/register", { redirect_uris: [REDIRECT], pad: "x".repeat(20_000) }));
    expect(huge.status).toBe(400);
  });

  it("token endpoint exchanges a code once, with no-store, and answers OAuth errors as JSON", async () => {
    const agency = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } });
    const agent = await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agency.id });
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const config = assistantConfig()!;
    const parsed = parseAuthorizeRequest(
      { response_type: "code", client_id: CLAUDE.clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256" },
      config,
    );
    if (!parsed.ok) throw new Error("parse");
    const code = await issueAuthCode({ userId: agent.id, agencyId: agency.id }, parsed.request);
    const fields = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier, resource: MCP };

    const ok = await token(form("http://localhost:3000/oauth/token", fields));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body).toMatchObject({ token_type: "Bearer", scope: "search:read", expires_in: 7 * 24 * 3600 });
    expect(typeof body.access_token).toBe("string");
    expect(body.refresh_token).toBeUndefined();

    const again = await token(form("http://localhost:3000/oauth/token", fields));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });

    const jsonBody = await token(json("http://localhost:3000/oauth/token", fields));
    expect(jsonBody.status).toBe(400);
    expect(await jsonBody.json()).toEqual({ error: "invalid_request" });
  });

  it("token endpoint is rate limited per IP", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) last = await token(form("http://localhost:3000/oauth/token", { grant_type: "authorization_code" }));
    expect(last!.status).toBe(429);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { setAgencyStatus } from "@/server/admin/agencies";
import { createSession, destroyUserSessions, getSession } from "@/server/auth/session";
import { assistantConfig } from "./config";
import { ASSISTANT_CLIENTS, clientById, clientForRedirects } from "./clients";
import { ACCESS_TOKEN_TTL_MS, AuthCodeRefused, exchangeCode, issueAuthCode, parseAuthorizeRequest } from "./oauth";
import { listConnections, revokeConnection, verifyAccessToken } from "./connections";

const config = { issuer: "https://app.example.com", mcpUrl: "https://mcp.example.com/mcp" };
const CLAUDE = ASSISTANT_CLIENTS.find((c) => c.name === "Claude")!;
const REDIRECT = CLAUDE.redirectUris[0]!;

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeParams(challenge: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: CLAUDE.clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-123",
    ...extra,
  };
}

let agencyA: string;
let agencyB: string;
let agentA: string;
let agentB: string;
let adminId: string;

async function connect(userId = agentA, agencyId = agencyA, now = new Date()) {
  const { verifier, challenge } = pkce();
  const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
  if (!parsed.ok) throw new Error("authorize request should parse");
  const code = await issueAuthCode({ userId, agencyId }, parsed.request, now);
  const result = await exchangeCode(
    { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier },
    config,
    now,
  );
  if (!result.ok) throw new Error(`exchange failed: ${result.error}`);
  return result.accessToken;
}

describe("assistant connector: configuration", () => {
  it("is off unless both APP_URL and ASSISTANT_MCP_URL are set", () => {
    expect(assistantConfig({ APP_URL: "https://app.example.com" })).toBeNull();
    expect(assistantConfig({ ASSISTANT_MCP_URL: "https://mcp.example.com/mcp" })).toBeNull();
    expect(assistantConfig({ APP_URL: "https://app.example.com", ASSISTANT_MCP_URL: "https://mcp.example.com/mcp" })).toEqual(config);
  });

  it("refuses plain http outside localhost, and URLs with a query or fragment", () => {
    expect(assistantConfig({ APP_URL: "http://app.example.com", ASSISTANT_MCP_URL: "https://mcp.example.com/mcp" })).toBeNull();
    expect(assistantConfig({ APP_URL: "https://app.example.com", ASSISTANT_MCP_URL: "http://mcp.example.com/mcp" })).toBeNull();
    expect(assistantConfig({ APP_URL: "https://app.example.com", ASSISTANT_MCP_URL: "https://mcp.example.com/mcp?x=1" })).toBeNull();
    expect(assistantConfig({ APP_URL: "https://app.example.com", ASSISTANT_MCP_URL: "not a url" })).toBeNull();
  });

  it("allows http://localhost outside a production build (tests, local runs)", () => {
    expect(assistantConfig({ APP_URL: "http://localhost:3000", ASSISTANT_MCP_URL: "http://localhost:3100/mcp", NODE_ENV: "test" })).toEqual({
      issuer: "http://localhost:3000",
      mcpUrl: "http://localhost:3100/mcp",
    });
    expect(assistantConfig({ APP_URL: "http://localhost:3000", ASSISTANT_MCP_URL: "http://localhost:3100/mcp", NODE_ENV: "production" })).toBeNull();
  });
});

describe("assistant connector: clients", () => {
  it("knows only fixed clients with fixed https redirect URIs", () => {
    expect(ASSISTANT_CLIENTS.length).toBeGreaterThan(0);
    for (const client of ASSISTANT_CLIENTS) {
      for (const uri of client.redirectUris) expect(new URL(uri).protocol).toBe("https:");
    }
    expect(clientById(CLAUDE.clientId)).toBe(CLAUDE);
    expect(clientById("someone-else")).toBeNull();
  });

  it("registration matches a client only when every redirect URI is that client's", () => {
    expect(clientForRedirects([REDIRECT])).toBe(CLAUDE);
    expect(clientForRedirects([REDIRECT, "https://evil.example.com/cb"])).toBeNull();
    expect(clientForRedirects(["https://evil.example.com/cb"])).toBeNull();
    expect(clientForRedirects([])).toBeNull();
  });
});

describe("assistant connector: authorize request", () => {
  const { challenge } = pkce();

  it("accepts a well-formed S256 request", () => {
    const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
    expect(parsed).toMatchObject({ ok: true, request: { clientId: CLAUDE.clientId, redirectUri: REDIRECT, state: "state-123", resource: config.mcpUrl } });
  });

  it("never redirects to an unknown client or a redirect URI that is not the client's", () => {
    expect(parseAuthorizeRequest(authorizeParams(challenge, { client_id: "nope" }), config)).toMatchObject({ ok: false, redirectable: false });
    expect(parseAuthorizeRequest(authorizeParams(challenge, { redirect_uri: "https://evil.example.com/cb" }), config)).toMatchObject({
      ok: false,
      redirectable: false,
    });
  });

  it("refuses plain PKCE, a missing challenge, another response type, a foreign resource or scope", () => {
    for (const extra of [
      { code_challenge_method: "plain" },
      { code_challenge: "" },
      { code_challenge: "short" },
      { response_type: "token" },
      { resource: "https://other.example.com/mcp" },
      { scope: "search:read booking:write" },
    ]) {
      const parsed = parseAuthorizeRequest(authorizeParams(challenge, extra), config);
      expect(parsed).toMatchObject({ ok: false, redirectable: true, redirectUri: REDIRECT, state: "state-123" });
    }
  });

  it("accepts the search scope and the MCP URL as resource", () => {
    const parsed = parseAuthorizeRequest(authorizeParams(challenge, { scope: "search:read", resource: config.mcpUrl }), config);
    expect(parsed.ok).toBe(true);
  });
});

describe("assistant connector: tokens", () => {
  beforeEach(async () => {
    await resetTestDb();
    agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
    agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
    agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
    agentB = (await createUser({ email: "b@other.example", name: "Ben", role: "AGENT", agencyId: agencyB })).id;
    adminId = (await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" })).id;
    // "Allow" is pressed in a live, verified session (issueAuthCode checks it again).
    await createSession(agentA, { verified: true });
    await createSession(agentB, { verified: true });
  });

  it("issues no code once the agent's sessions have ended (password change, lockout, suspension)", async () => {
    const { challenge } = pkce();
    const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
    if (!parsed.ok) throw new Error("parse");
    await destroyUserSessions(agentA);
    await expect(issueAuthCode({ userId: agentA, agencyId: agencyA }, parsed.request)).rejects.toBeInstanceOf(AuthCodeRefused);
    expect(await db.assistantAuthCode.count()).toBe(0);
  });

  it("a code issued before a password change can no longer be exchanged", async () => {
    const { verifier, challenge } = pkce();
    const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
    if (!parsed.ok) throw new Error("parse");
    const code = await issueAuthCode({ userId: agentA, agencyId: agencyA }, parsed.request);
    await destroyUserSessions(agentA);
    const result = await exchangeCode({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier }, config);
    expect(result).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("stores only hashes: no raw code or token in the database", async () => {
    const token = await connect();
    const [code] = await db.assistantAuthCode.findMany();
    const [connection] = await db.assistantConnection.findMany();
    expect(connection!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify([code, connection])).not.toContain(token);
    expect(connection).toMatchObject({ agencyId: agencyA, userId: agentA, scope: "search:read", resource: config.mcpUrl, clientName: "Claude" });
    expect(connection!.expiresAt.getTime() - connection!.createdAt.getTime()).toBe(ACCESS_TOKEN_TTL_MS);
  });

  it("a valid token gives the agency and user of the agent who allowed it", async () => {
    const token = await connect();
    expect(await verifyAccessToken(token, config)).toMatchObject({ agencyId: agencyA, userId: agentA });
  });

  it("an authorization code works once; a second use fails and revokes the connection it made", async () => {
    const { verifier, challenge } = pkce();
    const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
    if (!parsed.ok) throw new Error("parse");
    const code = await issueAuthCode({ userId: agentA, agencyId: agencyA }, parsed.request);
    const form = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier };
    const first = await exchangeCode(form, config);
    expect(first.ok).toBe(true);
    const second = await exchangeCode(form, config);
    expect(second).toMatchObject({ ok: false, error: "invalid_grant" });
    if (first.ok) expect(await verifyAccessToken(first.accessToken, config)).toBeNull();
    expect(await db.auditLog.count({ where: { action: "assistant.code_reuse_revoke" } })).toBe(1);
  });

  it("refuses a wrong verifier, client, redirect URI, resource, or an expired code (and the code is then spent)", async () => {
    const cases: [string, (f: Record<string, string>) => Record<string, string>, Date?][] = [
      ["verifier", (f) => ({ ...f, code_verifier: pkce().verifier })],
      ["client", (f) => ({ ...f, client_id: "nope" })],
      ["redirect", (f) => ({ ...f, redirect_uri: "https://evil.example.com/cb" })],
      ["resource", (f) => ({ ...f, resource: "https://other.example.com/mcp" })],
      ["grant type", (f) => ({ ...f, grant_type: "client_credentials" })],
      ["expired", (f) => f, new Date(Date.now() + 6 * 60_000)],
    ];
    for (const [name, change, at] of cases) {
      const { verifier, challenge } = pkce();
      const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
      if (!parsed.ok) throw new Error("parse");
      const code = await issueAuthCode({ userId: agentA, agencyId: agencyA }, parsed.request);
      const form = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier };
      const bad = await exchangeCode(change(form), config, at);
      expect(bad.ok, name).toBe(false);
      if (name !== "grant type" && name !== "client") expect(await exchangeCode(form, config), name).toMatchObject({ ok: false });
    }
    expect(await db.assistantConnection.count()).toBe(0);
  });

  it("does not issue a token when the agency was suspended between Allow and the exchange", async () => {
    const { verifier, challenge } = pkce();
    const parsed = parseAuthorizeRequest(authorizeParams(challenge), config);
    if (!parsed.ok) throw new Error("parse");
    const code = await issueAuthCode({ userId: agentA, agencyId: agencyA }, parsed.request);
    await setAgencyStatus(adminId, agencyA, "SUSPENDED");
    const result = await exchangeCode({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLAUDE.clientId, code_verifier: verifier }, config);
    expect(result).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("refuses garbage, an expired token, and a token for another resource", async () => {
    const token = await connect();
    expect(await verifyAccessToken("", config)).toBeNull();
    expect(await verifyAccessToken("x".repeat(500), config)).toBeNull();
    expect(await verifyAccessToken(`${token}x`, config)).toBeNull();
    expect(await verifyAccessToken(token, config, new Date(Date.now() + ACCESS_TOKEN_TTL_MS + 1000))).toBeNull();
    expect(await verifyAccessToken(token, { ...config, mcpUrl: "https://other.example.com/mcp" })).toBeNull();
  });

  it("an assistant token is not a session: getSession refuses it, and a session token is not an assistant token", async () => {
    const token = await connect();
    expect(await getSession(token)).toBeNull();
    const sessionToken = await createSession(agentA, { verified: true });
    expect(await verifyAccessToken(sessionToken, config)).toBeNull();
  });

  it("agency suspension revokes every connection of the agency", async () => {
    const token = await connect();
    await setAgencyStatus(adminId, agencyA, "SUSPENDED");
    expect(await verifyAccessToken(token, config)).toBeNull();
    await setAgencyStatus(adminId, agencyA, "ACTIVE");
    expect(await verifyAccessToken(token, config)).toBeNull(); // stays revoked
  });

  it("ending the user's sessions (password change, lockout) revokes the user's connections", async () => {
    const token = await connect();
    const other = await connect(agentB, agencyB);
    await destroyUserSessions(agentA);
    expect(await verifyAccessToken(token, config)).toBeNull();
    expect(await verifyAccessToken(other, config)).not.toBeNull();
  });

  it("a suspended user's token stops working at once", async () => {
    const token = await connect();
    await db.user.update({ where: { id: agentA }, data: { status: "SUSPENDED" } });
    expect(await verifyAccessToken(token, config)).toBeNull();
  });

  it("lists and revokes only the agency's own connections (no IDOR)", async () => {
    const token = await connect();
    await connect(agentB, agencyB);
    const own = await listConnections(agencyA);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ clientName: "Claude" });
    expect(JSON.stringify(own)).not.toContain("tokenHash");
    const otherId = (await listConnections(agencyB))[0]!.id;

    expect(await revokeConnection(agentA, agencyA, otherId)).toBe(false);
    expect(await listConnections(agencyB)).toHaveLength(1);

    expect(await revokeConnection(agentA, agencyA, own[0]!.id)).toBe(true);
    expect(await verifyAccessToken(token, config)).toBeNull();
    expect(await listConnections(agencyA)).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: "assistant.revoke", targetId: own[0]!.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "assistant.connect" } })).toBe(2);
  });
});

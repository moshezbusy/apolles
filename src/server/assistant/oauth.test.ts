import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { ASSISTANT_SCOPE, assistantConfig } from "./config";
import {
  approveAuthRequest,
  denyAuthRequest,
  exchangeToken,
  readAuthRequest,
  registerClient,
  startAuthorization,
} from "./oauth";
import { listConnections, revokeConnection, verifyAccessToken } from "./connections";

// The OAuth side of the AI assistant connector (plan 2026-11-22): a client registers (only Claude
// and ChatGPT redirect addresses), the agent approves on the consent page, the assistant swaps the
// one-time code (with PKCE) for a search:read token, and refreshes it. Every refusal is checked.

const RESOURCE = "https://mcp.apolles.test/mcp";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a".repeat(43) + "-verifier-for-tests";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const saved = { APP_URL: process.env.APP_URL, MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL };

async function agent(email = "agent@example.com", country = "IL") {
  const agency = await db.agency.create({ data: { name: "Agency", country, bankReference: `APL-${email}` } });
  const user = await createUser({ email, name: "Agent", role: "AGENT", agencyId: agency.id });
  return { userId: user.id, agencyId: agency.id };
}

async function client(redirect = CLAUDE) {
  const result = await registerClient({ redirect_uris: [redirect], client_name: "Claude" }, "203.0.113.5");
  if (result.status !== 201) throw new Error(`register failed: ${JSON.stringify(result.body)}`);
  return result.body.client_id as string;
}

function authorizeParams(clientId: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: ASSISTANT_SCOPE,
    resource: RESOURCE,
    ...extra,
  });
}

async function approvedCode(who: { userId: string; agencyId: string }, clientId?: string) {
  const id = clientId ?? (await client());
  const started = await startAuthorization(authorizeParams(id), "203.0.113.5");
  if (started.kind !== "consent") throw new Error(`authorize failed: ${JSON.stringify(started)}`);
  const approved = await approveAuthRequest(who, started.requestId);
  if (!approved) throw new Error("approve failed");
  const code = new URL(approved).searchParams.get("code");
  if (!code) throw new Error("no code");
  return { clientId: id, code, redirect: approved };
}

function tokenForm(values: Record<string, string>) {
  return new URLSearchParams(values);
}

async function connect(who: { userId: string; agencyId: string }) {
  const { clientId, code } = await approvedCode(who);
  const result = await exchangeToken(
    tokenForm({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: RESOURCE }),
    "203.0.113.5",
  );
  if (result.status !== 200) throw new Error(`token failed: ${JSON.stringify(result.body)}`);
  return { clientId, access: result.body.access_token as string, refresh: result.body.refresh_token as string };
}

describe("assistant OAuth", () => {
  beforeEach(async () => {
    await resetTestDb();
    process.env.APP_URL = "https://app.apolles.test";
    process.env.MCP_PUBLIC_URL = RESOURCE;
  });
  afterEach(() => {
    process.env.APP_URL = saved.APP_URL;
    if (saved.MCP_PUBLIC_URL === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = saved.MCP_PUBLIC_URL;
  });

  describe("config", () => {
    it("is off (null) until the connector address is set", () => {
      delete process.env.MCP_PUBLIC_URL;
      expect(assistantConfig()).toBeNull();
    });

    it("uses the app's origin as the issuer and the connector address as the resource", () => {
      expect(assistantConfig()).toEqual({ issuer: "https://app.apolles.test", resource: RESOURCE });
    });

    it("refuses a connector address that is not https (outside localhost)", () => {
      process.env.MCP_PUBLIC_URL = "http://mcp.apolles.test/mcp";
      expect(assistantConfig()).toBeNull();
    });
  });

  describe("client registration", () => {
    it("registers Claude and ChatGPT redirect addresses, named after the address, not the client's text", async () => {
      const claude = await registerClient({ redirect_uris: [CLAUDE], client_name: "Totally Legit Bank" }, "203.0.113.5");
      expect(claude.status).toBe(201);
      expect(claude.body).toMatchObject({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
      const row = await db.assistantClient.findUniqueOrThrow({ where: { id: claude.body.client_id as string } });
      expect(row.name).toBe("Claude");

      for (const uri of ["https://chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/abc_DEF-123"]) {
        const gpt = await registerClient({ redirect_uris: [uri] }, "203.0.113.5");
        expect(gpt.status).toBe(201);
        expect((await db.assistantClient.findUniqueOrThrow({ where: { id: gpt.body.client_id as string } })).name).toBe("ChatGPT");
      }
    });

    it("refuses any other redirect address", async () => {
      for (const uri of ["https://evil.example/callback", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/../x", "https://chatgpt.com/connector/oauth/a/b", "http://localhost:3118/callback"]) {
        const result = await registerClient({ redirect_uris: [uri] }, "203.0.113.5");
        expect(result.status, uri).toBe(400);
        expect(result.body.error).toBe("invalid_redirect_uri");
      }
      expect(await db.assistantClient.count()).toBe(0);
    });

    it("refuses mixed assistants, a secret-based client and junk", async () => {
      expect((await registerClient({ redirect_uris: [CLAUDE, "https://chatgpt.com/connector_platform_oauth_redirect"] }, "203.0.113.5")).status).toBe(400);
      expect((await registerClient({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_basic" }, "203.0.113.5")).status).toBe(400);
      expect((await registerClient("not json", "203.0.113.5")).status).toBe(400);
      expect((await registerClient({ redirect_uris: [] }, "203.0.113.5")).status).toBe(400);
    });

    it("is rate limited per network", async () => {
      let last = 0;
      for (let i = 0; i < 21; i++) last = (await registerClient({ redirect_uris: [CLAUDE] }, "198.51.100.7")).status;
      expect(last).toBe(429);
    });

    it("is off while the connector is not set up", async () => {
      delete process.env.MCP_PUBLIC_URL;
      expect((await registerClient({ redirect_uris: [CLAUDE] }, "203.0.113.5")).status).toBe(404);
    });
  });

  describe("authorize and consent", () => {
    it("never redirects to an address the client did not register (an error page instead)", async () => {
      const id = await client();
      const result = await startAuthorization(authorizeParams(id, { redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" }), "203.0.113.5");
      expect(result.kind).toBe("error_page");
      expect((await startAuthorization(authorizeParams("unknown-client"), "203.0.113.5")).kind).toBe("error_page");
    });

    it("sends other mistakes back to the assistant with the error, its state and our issuer", async () => {
      const id = await client();
      for (const [extra, error] of [
        [{ code_challenge_method: "plain" }, "invalid_request"],
        [{ code_challenge: "" }, "invalid_request"],
        [{ response_type: "token" }, "unsupported_response_type"],
        [{ scope: "search:read bookings:write" }, "invalid_scope"],
        [{ resource: "https://other.example/mcp" }, "invalid_target"],
      ] as const) {
        const result = await startAuthorization(authorizeParams(id, extra), "203.0.113.5");
        expect(result.kind, JSON.stringify(extra)).toBe("redirect");
        if (result.kind !== "redirect") continue;
        const url = new URL(result.location);
        expect(url.origin + url.pathname).toBe(CLAUDE);
        expect(url.searchParams.get("error")).toBe(error);
        expect(url.searchParams.get("state")).toBe("state-123");
        expect(url.searchParams.get("iss")).toBe("https://app.apolles.test");
      }
    });

    it("an approved request gives a one-time code, the state and the issuer to the registered address", async () => {
      const who = await agent();
      const { redirect } = await approvedCode(who);
      const url = new URL(redirect);
      expect(url.origin + url.pathname).toBe(CLAUDE);
      expect(url.searchParams.get("state")).toBe("state-123");
      expect(url.searchParams.get("iss")).toBe("https://app.apolles.test");
      const row = await db.assistantAuthRequest.findFirstOrThrow();
      expect(row.userId).toBe(who.userId);
      expect(row.codeHash).not.toBe(url.searchParams.get("code")); // only the hash is kept
      expect(await db.auditLog.count({ where: { action: "assistant.authorize", actorUserId: who.userId } })).toBe(1);
    });

    it("a request can be approved once, and not after it expired", async () => {
      const who = await agent();
      const id = await client();
      const started = await startAuthorization(authorizeParams(id), "203.0.113.5");
      if (started.kind !== "consent") throw new Error("expected consent");
      expect(await approveAuthRequest(who, started.requestId)).not.toBeNull();
      expect(await approveAuthRequest(who, started.requestId)).toBeNull();

      const again = await startAuthorization(authorizeParams(id), "203.0.113.5");
      if (again.kind !== "consent") throw new Error("expected consent");
      await db.assistantAuthRequest.update({ where: { id: again.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await approveAuthRequest(who, again.requestId)).toBeNull();
      expect(await readAuthRequest(again.requestId)).toBeNull();
    });

    it("deny sends access_denied back and removes the request", async () => {
      const id = await client();
      const started = await startAuthorization(authorizeParams(id), "203.0.113.5");
      if (started.kind !== "consent") throw new Error("expected consent");
      const location = await denyAuthRequest(started.requestId);
      expect(new URL(location ?? "x:").searchParams.get("error")).toBe("access_denied");
      expect(await db.assistantAuthRequest.count()).toBe(0);
    });

    it("the consent page shows the assistant's name and where it goes, never the client's own text", async () => {
      const id = await client();
      const started = await startAuthorization(authorizeParams(id), "203.0.113.5");
      if (started.kind !== "consent") throw new Error("expected consent");
      expect(await readAuthRequest(started.requestId)).toEqual({ id: started.requestId, clientName: "Claude", redirectHost: "claude.ai" });
    });
  });

  describe("token endpoint", () => {
    it("swaps the code (with the right PKCE verifier) for a search:read token pair", async () => {
      const who = await agent();
      const { clientId, code } = await approvedCode(who);
      const result = await exchangeToken(
        tokenForm({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: RESOURCE }),
        "203.0.113.5",
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ token_type: "Bearer", scope: ASSISTANT_SCOPE, expires_in: 3600 });
      const access = result.body.access_token as string;
      expect(access).toMatch(/^aplat_[A-Za-z0-9_-]{43}$/);
      expect(result.body.refresh_token as string).toMatch(/^aplrt_[A-Za-z0-9_-]{43}$/);
      const row = await db.assistantConnection.findFirstOrThrow();
      expect(row).toMatchObject({ userId: who.userId, agencyId: who.agencyId, scope: ASSISTANT_SCOPE, clientName: "Claude", resource: RESOURCE });
      expect(JSON.stringify(row)).not.toContain(access); // never stored as is
      expect(await verifyAccessToken(access)).toMatchObject({ userId: who.userId, agencyId: who.agencyId, connectionId: row.id });
      expect(await db.auditLog.count({ where: { action: "assistant.connect" } })).toBe(1);
    });

    it("refuses a wrong verifier, another client, another redirect address or another resource", async () => {
      const who = await agent();
      const other = await client();
      for (const change of [{ code_verifier: "b".repeat(50) }, { client_id: other }, { redirect_uri: "https://claude.com/api/mcp/auth_callback" }, { resource: "https://other.example/mcp" }]) {
        const { clientId, code } = await approvedCode(who);
        const values = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER, resource: RESOURCE, ...change };
        const result = await exchangeToken(tokenForm(values), "203.0.113.5");
        expect(result.status, JSON.stringify(change)).toBe(400);
        expect(result.body.error).toMatch(/^invalid_(grant|target)$/);
      }
      expect(await db.assistantConnection.count()).toBe(0);
    });

    it("a code works once; using it again revokes what it gave", async () => {
      const who = await agent();
      const { clientId, code } = await approvedCode(who);
      const form = () => tokenForm({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER });
      const first = await exchangeToken(form(), "203.0.113.5");
      expect(first.status).toBe(200);
      const second = await exchangeToken(form(), "203.0.113.5");
      expect(second.status).toBe(400);
      expect(second.body.error).toBe("invalid_grant");
      expect(await verifyAccessToken(first.body.access_token as string)).toBeNull();
    });

    it("an expired code is refused", async () => {
      const who = await agent();
      const { clientId, code } = await approvedCode(who);
      await db.assistantAuthRequest.updateMany({ data: { codeExpiresAt: new Date(Date.now() - 1000) } });
      const result = await exchangeToken(tokenForm({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER }), "203.0.113.5");
      expect(result.status).toBe(400);
    });

    it("a code approved by an agent who was suspended since gives no token", async () => {
      const who = await agent();
      const { clientId, code } = await approvedCode(who);
      await db.agency.update({ where: { id: who.agencyId }, data: { status: "SUSPENDED" } });
      const result = await exchangeToken(tokenForm({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE, code_verifier: VERIFIER }), "203.0.113.5");
      expect(result.status).toBe(400);
      expect(await db.assistantConnection.count()).toBe(0);
    });

    it("refresh gives a new pair and the old pair stops working; the old refresh token used again revokes the connection", async () => {
      const who = await agent();
      const first = await connect(who);
      const refreshed = await exchangeToken(tokenForm({ grant_type: "refresh_token", refresh_token: first.refresh, client_id: first.clientId }), "203.0.113.5");
      expect(refreshed.status).toBe(200);
      const access2 = refreshed.body.access_token as string;
      expect(access2).not.toBe(first.access);
      expect(await verifyAccessToken(first.access)).toBeNull();
      expect(await verifyAccessToken(access2)).not.toBeNull();

      const replay = await exchangeToken(tokenForm({ grant_type: "refresh_token", refresh_token: first.refresh, client_id: first.clientId }), "203.0.113.5");
      expect(replay.status).toBe(400);
      expect(replay.body.error).toBe("invalid_grant");
      expect(await verifyAccessToken(access2)).toBeNull();
      expect((await db.assistantConnection.findFirstOrThrow()).revokedReason).toBe("refresh_reuse");
    });

    it("refresh refuses another client, an unknown token and an unknown grant", async () => {
      const who = await agent();
      const first = await connect(who);
      const other = await client();
      expect((await exchangeToken(tokenForm({ grant_type: "refresh_token", refresh_token: first.refresh, client_id: other }), "203.0.113.5")).body.error).toBe("invalid_grant");
      expect((await exchangeToken(tokenForm({ grant_type: "refresh_token", refresh_token: "aplrt_" + "x".repeat(43), client_id: first.clientId }), "203.0.113.5")).body.error).toBe("invalid_grant");
      expect((await exchangeToken(tokenForm({ grant_type: "client_credentials", client_id: first.clientId }), "203.0.113.5")).body.error).toBe("unsupported_grant_type");
      expect((await exchangeToken(tokenForm({ grant_type: "password", username: "a", password: "b" }), "203.0.113.5")).body.error).toBe("unsupported_grant_type");
    });
  });

  describe("access tokens", () => {
    it("are refused when expired, revoked, for another resource, or not search:read", async () => {
      const who = await agent();
      const { access } = await connect(who);
      expect(await verifyAccessToken(access)).not.toBeNull();
      expect(await verifyAccessToken("")).toBeNull();
      expect(await verifyAccessToken("x".repeat(500))).toBeNull();

      await db.assistantConnection.updateMany({ data: { scope: "bookings:write" } });
      expect(await verifyAccessToken(access)).toBeNull();
      await db.assistantConnection.updateMany({ data: { scope: ASSISTANT_SCOPE, resource: "https://other.example/mcp" } });
      expect(await verifyAccessToken(access)).toBeNull();
      await db.assistantConnection.updateMany({ data: { resource: RESOURCE, accessExpiresAt: new Date(Date.now() - 1000) } });
      expect(await verifyAccessToken(access)).toBeNull();
    });

    it("are refused while the agency or the agent is suspended or the agent is locked out", async () => {
      const who = await agent();
      const { access } = await connect(who);
      await db.agency.update({ where: { id: who.agencyId }, data: { status: "SUSPENDED" } });
      expect(await verifyAccessToken(access)).toBeNull();
      await db.agency.update({ where: { id: who.agencyId }, data: { status: "ACTIVE" } });
      await db.user.update({ where: { id: who.userId }, data: { status: "SUSPENDED" } });
      expect(await verifyAccessToken(access)).toBeNull();
      await db.user.update({ where: { id: who.userId }, data: { status: "ACTIVE", lockedUntil: new Date(Date.now() + 60_000) } });
      expect(await verifyAccessToken(access)).toBeNull();
      await db.user.update({ where: { id: who.userId }, data: { lockedUntil: null } });
      expect(await verifyAccessToken(access)).not.toBeNull();
    });

    it("are refused while the connector is switched off", async () => {
      const who = await agent();
      const { access } = await connect(who);
      delete process.env.MCP_PUBLIC_URL;
      expect(await verifyAccessToken(access)).toBeNull();
    });
  });

  describe("the agent's list and Revoke", () => {
    it("lists only the agent's own live connections, and Revoke works only on the agent's own", async () => {
      const who = await agent();
      const other = await agent("other@example.com");
      const mine = await connect(who);
      const theirs = await connect(other);
      const list = await listConnections(who);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ clientName: "Claude" });
      expect(Object.keys(list[0] ?? {}).sort()).toEqual(["clientName", "createdAt", "id", "lastUsedAt"]);

      const theirRow = await db.assistantConnection.findFirstOrThrow({ where: { userId: other.userId } });
      expect(await revokeConnection(who, theirRow.id)).toBe(false); // no IDOR
      expect(await verifyAccessToken(theirs.access)).not.toBeNull();

      expect(await revokeConnection(who, list[0]!.id)).toBe(true);
      expect(await verifyAccessToken(mine.access)).toBeNull();
      expect(await listConnections(who)).toEqual([]);
      expect(await db.auditLog.count({ where: { action: "assistant.revoke", actorUserId: who.userId } })).toBe(1);
      // A revoked connection cannot be refreshed either.
      expect((await exchangeToken(tokenForm({ grant_type: "refresh_token", refresh_token: mine.refresh, client_id: mine.clientId }), "203.0.113.5")).status).toBe(400);
    });
  });
});

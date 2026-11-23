import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { createSession, getSession } from "@/server/auth/session";
import { MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";
import { recordFailedAttempt, reserveAttempt } from "@/server/auth/lockout";
import { consumePasswordToken, issuePasswordToken } from "@/server/auth/password-tokens";
import { setAgencyStatus } from "@/server/admin/agencies";
import { aiSearchEnabled, appIssuer, mcpResource, serviceKeyMatches } from "@/server/ai/config";
import {
  exchangeCode,
  issueAuthCode,
  listConnections,
  openConnectWindow,
  refresh,
  revokeConnection,
  useConnectWindow,
  verifyAiToken,
  type TokenPair,
} from "@/server/ai/tokens";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const RESOURCE = "https://mcp.example.test/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let bankRef = 0;

async function createAgent(email = "agent@example.com") {
  bankRef += 1;
  const agency = await db.agency.create({
    data: { name: "Agency", country: "IL", bankReference: `APL-${String(bankRef).padStart(4, "0")}` },
  });
  const user = await createUser({ email, name: "Agent", role: "AGENT", agencyId: agency.id });
  return { userId: user.id, agencyId: agency.id };
}

async function createClient(name = "Claude") {
  return db.aiClient.create({ data: { name, redirectUris: [REDIRECT] } });
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function isPair(result: TokenPair | { error: string }): result is TokenPair {
  return "accessToken" in result;
}

// One full connect: a code, then its exchange. Returns everything a test needs.
async function connect(agent: { userId: string; agencyId: string }, clientId: string) {
  const { verifier, challenge } = pkce();
  const code = await issueAuthCode({
    userId: agent.userId,
    clientId,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    resource: RESOURCE,
  });
  const result = await exchangeCode({ code, clientId, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE });
  if (!isPair(result)) throw new Error(`exchange failed: ${result.error}`);
  const { connectionId } = await db.aiAuthCode.findUniqueOrThrow({
    where: { codeHash: createHash("sha256").update(code).digest("hex") },
  });
  return { code, verifier, pair: result, connectionId: connectionId! };
}

describe("AI search tokens", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test/");
    vi.stubEnv("APP_URL", "https://app.example.test/");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("config", () => {
    it("the feature is on only when AI_SEARCH_ENABLED is exactly 'true'", () => {
      vi.stubEnv("AI_SEARCH_ENABLED", "true");
      expect(aiSearchEnabled()).toBe(true);
      for (const value of ["", "TRUE", "1", "yes", "false"]) {
        vi.stubEnv("AI_SEARCH_ENABLED", value);
        expect(aiSearchEnabled()).toBe(false);
      }
    });

    it("the MCP resource is MCP_PUBLIC_URL + /mcp and the issuer is APP_URL, without trailing slashes", () => {
      expect(mcpResource()).toBe(RESOURCE);
      expect(appIssuer()).toBe("https://app.example.test");
      vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test");
      expect(mcpResource()).toBe(RESOURCE);
    });

    it("a missing or invalid MCP_PUBLIC_URL / APP_URL fails loudly", () => {
      vi.stubEnv("MCP_PUBLIC_URL", "");
      expect(() => mcpResource()).toThrow();
      vi.stubEnv("APP_URL", "not a url");
      expect(() => appIssuer()).toThrow();
    });

    it("the service key matches only the configured, non-empty key", () => {
      vi.stubEnv("AI_MCP_SERVICE_KEY", "");
      expect(serviceKeyMatches("")).toBe(false);
      expect(serviceKeyMatches(null)).toBe(false);
      vi.stubEnv("AI_MCP_SERVICE_KEY", "s3rvice-key-for-tests-0123456789ab");
      expect(serviceKeyMatches(null)).toBe(false);
      expect(serviceKeyMatches("")).toBe(false);
      expect(serviceKeyMatches("s3rvice-key-for-tests-0123456789a")).toBe(false);
      expect(serviceKeyMatches("s3rvice-key-for-tests-0123456789ab")).toBe(true);
    });

    // F9: a short key set by hand would weaken the internal API's second factor.
    it("a configured key shorter than 32 characters matches nothing, with one error line", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const short = "a".repeat(31);
      vi.stubEnv("AI_MCP_SERVICE_KEY", short);
      expect(serviceKeyMatches(short)).toBe(false);
      expect(serviceKeyMatches(short)).toBe(false);
      expect(error.mock.calls).toEqual([["AI_MCP_SERVICE_KEY is shorter than 32 characters: the AI API refuses every call"]]);
      vi.stubEnv("AI_MCP_SERVICE_KEY", "a".repeat(32));
      expect(serviceKeyMatches("a".repeat(32))).toBe(true);
      error.mockRestore();
    });

    // F8: the same address written another way is the same audience.
    it("MCP_PUBLIC_URL is normalized: lower-case host, no trailing slash", () => {
      vi.stubEnv("MCP_PUBLIC_URL", "https://MCP.Example.TEST/");
      expect(mcpResource()).toBe("https://mcp.example.test/mcp");
      vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test:443");
      expect(mcpResource()).toBe("https://mcp.example.test/mcp");
      vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test/?x=1");
      expect(() => mcpResource()).toThrow();
    });
  });

  describe("connect window", () => {
    it("opened by a session: usable once, only by that user and that session", async () => {
      const agent = await createAgent();
      const other = await createAgent("other@example.com");
      await openConnectWindow(agent.userId, "session-a");

      expect(await useConnectWindow(other.userId, "session-a")).toBe(false);
      expect(await useConnectWindow(agent.userId, "session-b")).toBe(false);
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(true);
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(false);
    });

    it("closes after 10 minutes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = new Date("2026-11-22T10:00:00Z");
      vi.setSystemTime(start);
      const agent = await createAgent();
      await openConnectWindow(agent.userId, "session-a");
      vi.setSystemTime(start.getTime() + 10 * 60 * 1000 + 1000);
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(false);
    });

    it("two parallel uses of one window → exactly one succeeds", async () => {
      const agent = await createAgent();
      await openConnectWindow(agent.userId, "session-a");
      const results = await Promise.all(
        Array.from({ length: 5 }, () => useConnectWindow(agent.userId, "session-a")),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("authorization code", () => {
    it("stores only the sha256 of the code, valid for 60 seconds", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const before = Date.now();
      const code = await issueAuthCode({
        userId: agent.userId,
        clientId: client.id,
        redirectUri: REDIRECT,
        codeChallenge: pkce().challenge,
        resource: RESOURCE,
      });
      const row = await db.aiAuthCode.findFirstOrThrow();
      expect(row.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
      expect(row.connectionId).toBeNull();
    });

    it("exchange → a new search:read connection for the agent and a 1-hour access token", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);

      expect(pair).toMatchObject({ expiresIn: 3600, scope: "search:read" });
      expect(pair.accessToken).not.toBe(pair.refreshToken);
      const connection = await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection).toMatchObject({
        userId: agent.userId,
        agencyId: agent.agencyId,
        clientId: client.id,
        scope: "search:read",
        resource: RESOURCE,
        revokedAt: null,
      });
      const token = await db.aiToken.findFirstOrThrow({ where: { connectionId } });
      expect(token.accessHash).toBe(createHash("sha256").update(pair.accessToken).digest("hex"));
      expect(token.refreshHash).toBe(createHash("sha256").update(pair.refreshToken).digest("hex"));
      expect(token.accessExpiresAt.getTime() - Date.now()).toBeGreaterThan(3590_000);
      expect(token.accessExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
      expect(token.refreshExpiresAt.getTime() - Date.now()).toBeGreaterThan(30 * 86_400_000 - 10_000);
    });

    it("each connect creates its own connection", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const first = await connect(agent, client.id);
      const second = await connect(agent, client.id);
      expect(first.connectionId).not.toBe(second.connectionId);
      expect(await db.aiConnection.count()).toBe(2);
    });

    it("code is single use; a second exchange → invalid_grant and revokes the tokens of that code's connection", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const other = await connect(agent, client.id);
      const { code, verifier, pair, connectionId } = await connect(agent, client.id);

      const again = await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE });
      expect(again).toEqual({ error: "invalid_grant" });

      const connection = await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection.revokedAt).not.toBeNull();
      expect(connection.revokedReason).toBe("code_reuse");
      const audits = await db.auditLog.findMany({ where: { action: "ai.revoke" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: agent.userId, targetType: "AiConnection", targetId: connectionId, after: { reason: "code_reuse" } });
      // A third use finds the connection already revoked: no second audit row.
      await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE });
      expect(await db.auditLog.count({ where: { action: "ai.revoke" } })).toBe(1);
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();
      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      // Only that code's connection ends.
      expect(await verifyAiToken(other.pair.accessToken, RESOURCE)).not.toBeNull();
    });

    it("two parallel exchanges of one code → at most one token pair, and the connection ends", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { verifier, challenge } = pkce();
      const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE }),
        ),
      );
      const pairs = results.filter(isPair);
      expect(pairs).toHaveLength(1);
      expect(await db.aiConnection.count()).toBe(1);
      expect(await verifyAiToken(pairs[0]!.accessToken, RESOURCE)).toBeNull();
    });

    describe("refused with invalid_grant (and nothing issued)", () => {
      async function issued() {
        const agent = await createAgent();
        const client = await createClient();
        const { verifier, challenge } = pkce();
        const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
        const good = { code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE };
        return { agent, client, good };
      }

      it("wrong code_verifier", async () => {
        const { good } = await issued();
        expect(await exchangeCode({ ...good, codeVerifier: pkce().verifier })).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });

      it("the challenge itself sent as verifier (plain PKCE is not accepted)", async () => {
        const agent = await createAgent();
        const client = await createClient();
        const plain = pkce().verifier;
        const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: plain, resource: RESOURCE });
        expect(await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: plain, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      });

      it("wrong redirect_uri", async () => {
        const { good } = await issued();
        expect(await exchangeCode({ ...good, redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect" })).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });

      it("wrong resource", async () => {
        const { good } = await issued();
        expect(await exchangeCode({ ...good, resource: "https://evil.example/mcp" })).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });

      it("another client", async () => {
        const { good } = await issued();
        const otherClient = await createClient("ChatGPT");
        expect(await exchangeCode({ ...good, clientId: otherClient.id })).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });

      it("unknown or oversized code", async () => {
        const { good } = await issued();
        expect(await exchangeCode({ ...good, code: "nope" })).toEqual({ error: "invalid_grant" });
        expect(await exchangeCode({ ...good, code: "x".repeat(500) })).toEqual({ error: "invalid_grant" });
      });

      it("code after 61 s", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const start = new Date("2026-11-22T10:00:00Z");
        vi.setSystemTime(start);
        const { good } = await issued();
        vi.setSystemTime(start.getTime() + 61_000);
        expect(await exchangeCode(good)).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });

      it("the agent or the agency was suspended after the code was issued", async () => {
        const first = await issued();
        await db.user.update({ where: { id: first.agent.userId }, data: { status: "SUSPENDED" } });
        expect(await exchangeCode(first.good)).toEqual({ error: "invalid_grant" });

        await resetTestDb();
        const second = await issued();
        await db.agency.update({ where: { id: second.agent.agencyId }, data: { status: "SUSPENDED" } });
        expect(await exchangeCode(second.good)).toEqual({ error: "invalid_grant" });
        expect(await db.aiToken.count()).toBe(0);
      });
    });

    it("a malformed code_verifier → invalid_request", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: pkce().challenge, resource: RESOURCE });
      for (const codeVerifier of ["short", "x".repeat(129), `${"a".repeat(43)} `, `${"a".repeat(42)}+`]) {
        expect(await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT, codeVerifier, resource: RESOURCE })).toEqual({ error: "invalid_request" });
      }
    });
  });

  describe("refresh", () => {
    it("rotates: the new pair works; the old refresh token then → invalid_grant and the connection is revoked", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);

      const next = await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE });
      if (!isPair(next)) throw new Error(next.error);
      expect(next).toMatchObject({ expiresIn: 3600, scope: "search:read" });
      expect(next.refreshToken).not.toBe(pair.refreshToken);
      expect(await verifyAiToken(next.accessToken, RESOURCE)).toMatchObject({ connectionId });
      // The old access token stops at once.
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();

      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      const connection = await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection.revokedReason).toBe("refresh_reuse");
      expect(connection.revokedAt).not.toBeNull();
      const audits = await db.auditLog.findMany({ where: { action: "ai.revoke" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: agent.userId, targetType: "AiConnection", targetId: connectionId, after: { reason: "refresh_reuse" } });
      expect(await verifyAiToken(next.accessToken, RESOURCE)).toBeNull();
      expect(await refresh({ refreshToken: next.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
    });

    it("parallel refreshes of one token → at most one new pair, and the connection is revoked", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })),
      );
      expect(results.filter(isPair).length).toBeLessThanOrEqual(1);
      const connection = await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection.revokedReason).toBe("refresh_reuse");
      for (const r of results.filter(isPair)) expect(await verifyAiToken(r.accessToken, RESOURCE)).toBeNull();
    });

    it("another client, another resource, unknown token → invalid_grant, the connection stays", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const otherClient = await createClient("ChatGPT");
      const { pair, connectionId } = await connect(agent, client.id);

      expect(await refresh({ refreshToken: pair.refreshToken, clientId: otherClient.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: "https://evil.example/mcp" })).toEqual({ error: "invalid_grant" });
      expect(await refresh({ refreshToken: "unknown", clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      expect(await refresh({ refreshToken: pair.accessToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } })).revokedAt).toBeNull();
      // The refresh token was not spent by the refused calls.
      expect(isPair(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE }))).toBe(true);
    });

    it("a refresh token after 30 days → invalid_grant", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = new Date("2026-11-22T10:00:00Z");
      vi.setSystemTime(start);
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      vi.setSystemTime(start.getTime() + 30 * 86_400_000 + 1000);
      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
    });

    it("a suspended agency cannot refresh", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      await db.agency.update({ where: { id: agent.agencyId }, data: { status: "SUSPENDED" } });
      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
    });
  });

  describe("verifyAiToken", () => {
    it("a valid token → connection, user and agency, and lastUsedAt is updated", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } })).lastUsedAt).toBeNull();

      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toEqual({
        connectionId,
        userId: agent.userId,
        agencyId: agent.agencyId,
      });
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } })).lastUsedAt).not.toBeNull();
    });

    it("null for an unknown, empty or oversized token, or a refresh token", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      expect(await verifyAiToken("unknown", RESOURCE)).toBeNull();
      expect(await verifyAiToken("", RESOURCE)).toBeNull();
      expect(await verifyAiToken("x".repeat(500), RESOURCE)).toBeNull();
      expect(await verifyAiToken(pair.refreshToken, RESOURCE)).toBeNull();
    });

    it("null after 1 hour", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const start = new Date("2026-11-22T10:00:00Z");
      vi.setSystemTime(start);
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      vi.setSystemTime(start.getTime() + 3600_000 + 1000);
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();
    });

    it("null for another resource", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      expect(await verifyAiToken(pair.accessToken, "https://evil.example/mcp")).toBeNull();
    });

    it("null for a revoked connection, a suspended user, a suspended agency, an admin", async () => {
      const client = await createClient();
      const cases: [string, (a: { userId: string; agencyId: string }, connectionId: string) => Promise<unknown>][] = [
        ["revoked", (_a, id) => db.aiConnection.update({ where: { id }, data: { revokedAt: new Date(), revokedReason: "test" } })],
        ["user suspended", (a) => db.user.update({ where: { id: a.userId }, data: { status: "SUSPENDED" } })],
        ["agency suspended", (a) => db.agency.update({ where: { id: a.agencyId }, data: { status: "SUSPENDED" } })],
        ["admin", (a) => db.user.update({ where: { id: a.userId }, data: { role: "ADMIN" } })],
      ];
      for (const [label, change] of cases) {
        const agent = await createAgent(`${label.replace(/ /g, "-")}@example.com`);
        const { pair, connectionId } = await connect(agent, client.id);
        expect(await verifyAiToken(pair.accessToken, RESOURCE), label).not.toBeNull();
        await change(agent, connectionId);
        expect(await verifyAiToken(pair.accessToken, RESOURCE), label).toBeNull();
      }
    });

    it("a search token is not a session", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      await createSession(agent.userId, { verified: true });
      expect(await getSession(pair.accessToken)).toBeNull();
      expect(await getSession(pair.refreshToken)).toBeNull();
    });
  });

  describe("revokeConnection and listConnections", () => {
    it("the agent revokes its own connection: tokens stop at once, audit ai.revoke", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);

      expect(await revokeConnection(agent.agencyId, connectionId, agent.userId)).toBe(true);
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();
      expect(await refresh({ refreshToken: pair.refreshToken, clientId: client.id, resource: RESOURCE })).toEqual({ error: "invalid_grant" });
      const connection = await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(connection.revokedAt).not.toBeNull();
      expect(connection.revokedReason).toBe("agent_revoke");
      expect(await db.aiToken.count({ where: { connectionId } })).toBe(0);

      const row = await db.auditLog.findFirstOrThrow({ where: { action: "ai.revoke" } });
      expect(row).toMatchObject({ actorUserId: agent.userId, targetType: "AiConnection", targetId: connectionId });
      // Revoking again changes nothing.
      expect(await revokeConnection(agent.agencyId, connectionId, agent.userId)).toBe(false);
      expect(await db.auditLog.count({ where: { action: "ai.revoke" } })).toBe(1);
    });

    it("another agency's connection id → false, nothing changes", async () => {
      const agent = await createAgent();
      const intruder = await createAgent("intruder@example.com");
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);

      expect(await revokeConnection(intruder.agencyId, connectionId, intruder.userId)).toBe(false);
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } })).revokedAt).toBeNull();
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).not.toBeNull();
      expect(await db.auditLog.count()).toBe(0);
      expect(await revokeConnection(intruder.agencyId, "unknown", intruder.userId)).toBe(false);
    });

    it("lists only the agency's open connections, newest first, named by the assistant", async () => {
      const agent = await createAgent();
      const other = await createAgent("other@example.com");
      const claude = await createClient("Claude");
      const chatgpt = await createClient("ChatGPT");
      const first = await connect(agent, claude.id);
      const second = await connect(agent, chatgpt.id);
      const revoked = await connect(agent, claude.id);
      await connect(other, claude.id);
      await revokeConnection(agent.agencyId, revoked.connectionId, agent.userId);
      await verifyAiToken(first.pair.accessToken, RESOURCE);

      const { connections: list, nextCursor } = await listConnections(agent.agencyId);
      expect(nextCursor).toBeNull();
      expect(list.map((c) => c.id)).toEqual([second.connectionId, first.connectionId]);
      expect(list[0]).toEqual({ id: second.connectionId, assistant: "ChatGPT", createdAt: expect.any(Date), lastUsedAt: null });
      expect(list[1]).toMatchObject({ assistant: "Claude", lastUsedAt: expect.any(Date) });
    });

    it("a client with another name is still listed (so it can be revoked), as 'AI assistant'", async () => {
      const agent = await createAgent();
      const odd = await createClient("Some Bot");
      const { connectionId } = await connect(agent, odd.id);
      const { connections } = await listConnections(agent.agencyId);
      expect(connections).toEqual([{ id: connectionId, assistant: "AI assistant", createdAt: expect.any(Date), lastUsedAt: null }]);
    });

    it("pages: 20 by default, at most 50, cursor = last id, each connection exactly once", async () => {
      const agent = await createAgent();
      const other = await createAgent("other@example.com");
      const client = await createClient();
      const base = Date.now() - 1000 * 60;
      const ids: string[] = [];
      for (let n = 0; n < 23; n++) {
        const row = await db.aiConnection.create({
          data: {
            userId: agent.userId,
            agencyId: agent.agencyId,
            clientId: client.id,
            scope: "search:read",
            resource: RESOURCE,
            // Two rows share each timestamp, so the id tie-break is exercised.
            createdAt: new Date(base + Math.floor(n / 2) * 1000),
          },
        });
        ids.push(row.id);
      }
      await connect(other, client.id);

      const page1 = await listConnections(agent.agencyId);
      expect(page1.connections).toHaveLength(20);
      expect(page1.nextCursor).toBe(page1.connections[19]!.id);
      const page2 = await listConnections(agent.agencyId, page1.nextCursor!);
      expect(page2.connections).toHaveLength(3);
      expect(page2.nextCursor).toBeNull();
      const seen = [...page1.connections, ...page2.connections].map((c) => c.id);
      expect(new Set(seen).size).toBe(23);
      expect(seen.sort()).toEqual([...ids].sort());

      expect((await listConnections(agent.agencyId, undefined, 500)).connections).toHaveLength(23);
      expect((await listConnections(agent.agencyId, undefined, 5)).connections).toHaveLength(5);
      // Another agency's id is not a valid cursor here.
      const theirs = await db.aiConnection.findFirstOrThrow({ where: { agencyId: other.agencyId } });
      await expect(listConnections(agent.agencyId, theirs.id)).rejects.toThrow("Invalid cursor");
    });

    it("take is clamped to 50", async () => {
      const agent = await createAgent();
      const client = await createClient();
      await db.aiConnection.createMany({
        data: Array.from({ length: 55 }, () => ({
          userId: agent.userId,
          agencyId: agent.agencyId,
          clientId: client.id,
          scope: "search:read",
          resource: RESOURCE,
        })),
      });
      const page = await listConnections(agent.agencyId, undefined, 500);
      expect(page.connections).toHaveLength(50);
      expect(page.nextCursor).not.toBeNull();
    });
  });

  describe("a code or connect window opened before the account's access ended cannot be used after", () => {
    async function pending() {
      const agent = await createAgent();
      const client = await createClient();
      const { verifier, challenge } = pkce();
      const code = await issueAuthCode({ userId: agent.userId, clientId: client.id, redirectUri: REDIRECT, codeChallenge: challenge, resource: RESOURCE });
      await openConnectWindow(agent.userId, "session-a");
      const good = { code, clientId: client.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE };
      return { agent, good };
    }

    it("password reset → the code exchange is invalid_grant and the window is closed", async () => {
      const { agent, good } = await pending();
      expect(await consumePasswordToken(await issuePasswordToken(agent.userId, "RESET"), "newpass34")).toBe("OK");
      expect(await exchangeCode(good)).toEqual({ error: "invalid_grant" });
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(false);
      expect(await db.aiToken.count()).toBe(0);
      expect(await db.aiConnection.count()).toBe(0);
    });

    it("lockout that ends sessions → the code exchange is invalid_grant and the window is closed", async () => {
      const { agent, good } = await pending();
      await db.user.update({ where: { id: agent.userId }, data: { failedLogins: MAX_FAILED_LOGINS } });
      await recordFailedAttempt({ id: agent.userId, email: "agent@example.com" }, MAX_FAILED_LOGINS, { endSessionsOnLock: true });
      expect(await exchangeCode(good)).toEqual({ error: "invalid_grant" });
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(false);
      expect(await db.aiConnection.count()).toBe(0);
    });

    it("agency suspension → the code exchange is invalid_grant, also after reactivation, and the window is closed", async () => {
      const { agent, good } = await pending();
      const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
      await setAgencyStatus(admin.id, agent.agencyId, "SUSPENDED");
      await setAgencyStatus(admin.id, agent.agencyId, "ACTIVE");
      expect(await exchangeCode(good)).toEqual({ error: "invalid_grant" });
      expect(await useConnectWindow(agent.userId, "session-a")).toBe(false);
      expect(await db.aiConnection.count()).toBe(0);
    });
  });

  describe("lockout ends the assistant connections with the sessions", () => {
    it("the attempt that locks the account (sessions ended) revokes the user's connections, audit ai.revoke_all", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair, connectionId } = await connect(agent, client.id);
      await db.user.update({ where: { id: agent.userId }, data: { failedLogins: MAX_FAILED_LOGINS } });

      const outcome = await recordFailedAttempt({ id: agent.userId, email: "agent@example.com" }, MAX_FAILED_LOGINS, { endSessionsOnLock: true });
      expect(outcome).toBe("LOCKED");
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: connectionId } })).revokedReason).toBe("lockout");
      const row = await db.auditLog.findFirstOrThrow({ where: { action: "ai.revoke_all" } });
      expect(row).toMatchObject({ actorUserId: agent.userId, targetType: "User", targetId: agent.userId });
    });

    it("a stuck slot healed into a lock revokes the user's connections", async () => {
      const agent = await createAgent();
      const client = await createClient();
      const { pair } = await connect(agent, client.id);
      await db.user.update({ where: { id: agent.userId }, data: { failedLogins: MAX_FAILED_LOGINS, attemptReservedAt: null } });

      expect(await reserveAttempt(agent.userId)).toBeNull();
      expect(await verifyAiToken(pair.accessToken, RESOURCE)).toBeNull();
    });

    it("a lock that does not end sessions (password step) keeps the connections, like the sessions", async () => {
      const agent = await createAgent();
      const client = await createClient();
      await connect(agent, client.id);
      await db.user.update({ where: { id: agent.userId }, data: { failedLogins: MAX_FAILED_LOGINS } });
      await recordFailedAttempt({ id: agent.userId, email: "agent@example.com" }, MAX_FAILED_LOGINS);
      expect(await db.aiConnection.count({ where: { revokedAt: null } })).toBe(1);
    });
  });
});

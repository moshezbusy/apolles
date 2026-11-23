import { createHash, randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { seedRateLimit } from "@/test/rate-limit";
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { openConnectWindow } from "@/server/ai/tokens";
import { sendEmail } from "@/server/email/port";
import AuthorizePage from "@/app/oauth/authorize/page";
import { allowAction, denyAction } from "@/app/oauth/authorize/actions";
import LoginPage from "@/app/login/page";
import VerifyPage from "@/app/login/verify/page";
import { loginAction } from "@/app/login/actions";
import { verifyCodeAction } from "@/app/login/verify/actions";

const jar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(requestHeaders)),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const ISSUER = "https://app.example.test";
const RESOURCE = "https://mcp.example.test/mcp";
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const IP = "203.0.113.7";
const PASSWORD = "abcdefg1";
const NO_WINDOW = "To connect an assistant, start from Agency settings → AI assistants.";
const WARNING = "Continue only if you started this yourself in Claude or ChatGPT a moment ago.";

type Params = Record<string, string>;

let agent: { id: string; agencyId: string };
let sessionId: string;
let clientId: string;
let params: Params;

function challenge(): string {
  return createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
}

function decode(html: string): string {
  return html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function formOf(fields: Params): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function render(search: Params): Promise<string> {
  return decode(renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(search) })));
}

// The URL a redirect went to (the mock throws "NEXT_REDIRECT:<url>").
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("NEXT_REDIRECT:")) return message.slice("NEXT_REDIRECT:".length);
    throw error;
  }
  throw new Error("no redirect");
}

async function signIn(userId: string): Promise<string> {
  const token = await createSession(userId, { verified: true });
  jar.set(SESSION_COOKIE, token);
  return (await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } })).id;
}

function authorizePath(search: Params): string {
  return `/oauth/authorize?${new URLSearchParams(search).toString()}`;
}

// A copy of `fields` without `key`.
function without<T extends Record<string, string>>(fields: T, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => k !== key));
}

beforeEach(async () => {
  await resetTestDb();
  jar.clear();
  requestHeaders.clear();
  requestHeaders.set("x-forwarded-for", IP);
  vi.stubEnv("AI_SEARCH_ENABLED", "true");
  vi.stubEnv("APP_URL", ISSUER);
  vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test");
  vi.mocked(sendEmail).mockClear();
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
  const user = await createUser({
    email: "agent@example.com",
    name: "Agent",
    role: "AGENT",
    agencyId: agency.id,
    passwordHash: await hashPassword(PASSWORD),
  });
  agent = { id: user.id, agencyId: agency.id };
  sessionId = await signIn(agent.id);
  clientId = (await db.aiClient.create({ data: { name: "Claude", redirectUris: [CLAUDE_REDIRECT] } })).id;
  params = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_REDIRECT,
    code_challenge: challenge(),
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope: "search:read offline_access",
    state: "st-123",
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("/oauth/authorize page", () => {
  it("off → 404", async () => {
    vi.stubEnv("AI_SEARCH_ENABLED", "false");
    await expect(render(params)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("with an open connect window → the consent page of mockup 20", async () => {
    await openConnectWindow(agent.id, sessionId);
    const html = await render(params);
    expect(html).toContain("Connect Claude to Apolles");
    expect(html).toContain("Claude wants to search hotels and rates for you.");
    for (const text of [
      "Search hotels and rates",
      "Open a result in Apolles to book",
      "Book, cancel or issue vouchers",
      "See guests or your balance",
      WARNING,
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<button[^>]*>Allow<\/button>/);
    expect(html).toMatch(/<button[^>]*>Deny<\/button>/);
    expect(html).toContain(`name="state" value="st-123"`);
    expect(html).not.toContain(NO_WINDOW);
  });

  it("names ChatGPT for a ChatGPT client", async () => {
    const chatgpt = await db.aiClient.create({ data: { name: "ChatGPT", redirectUris: [CHATGPT_REDIRECT] } });
    await openConnectWindow(agent.id, sessionId);
    const html = await render({ ...params, client_id: chatgpt.id, redirect_uri: CHATGPT_REDIRECT });
    expect(html).toContain("Connect ChatGPT to Apolles");
    expect(html).toContain("ChatGPT wants to search hotels and rates for you.");
  });

  it("no open connect window → says where to start, and offers no Allow", async () => {
    const html = await render(params);
    expect(html).toContain(NO_WINDOW);
    expect(html).not.toMatch(/>Allow</);
  });

  it("a window opened by another session of the same agent does not count", async () => {
    const otherSession = await createSession(agent.id, { verified: true });
    const other = await db.session.findFirstOrThrow({ where: { userId: agent.id, NOT: { id: sessionId } } });
    expect(otherSession).toBeTruthy();
    await openConnectWindow(agent.id, other.id);
    expect(await render(params)).toContain(NO_WINDOW);
  });

  it("unknown extra parameters are ignored", async () => {
    await openConnectWindow(agent.id, sessionId);
    expect(await render({ ...params, prompt: "consent", foo: "bar" })).toMatch(/>Allow</);
  });

  it("unknown client, or a redirect URI not registered for that client → error page, never a redirect", async () => {
    await openConnectWindow(agent.id, sessionId);
    for (const search of [
      { ...params, client_id: "unknown-client" },
      { ...params, client_id: "https://evil.example/client.json" },
      { ...params, redirect_uri: CHATGPT_REDIRECT },
      { ...params, redirect_uri: "https://evil.example/cb" },
      { ...params, redirect_uri: `${CLAUDE_REDIRECT}/` },
    ]) {
      const html = await render(search);
      expect(html).toContain("This connection link does not work");
      expect(html).not.toMatch(/>Allow</);
    }
    expect(await db.aiAuthCode.count()).toBe(0);
  });

  it("missing or plain PKCE → error back to the assistant (with iss), no consent and no code", async () => {
    await openConnectWindow(agent.id, sessionId);
    const noChallenge = without(params, "code_challenge");
    for (const search of [noChallenge, { ...params, code_challenge_method: "plain" }, { ...params, code_challenge: "short" }]) {
      const url = new URL(await redirectOf(() => render(search)));
      expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_REDIRECT);
      expect(Object.fromEntries(url.searchParams)).toEqual({ error: "invalid_request", state: "st-123", iss: ISSUER });
    }
    expect(await db.aiAuthCode.count()).toBe(0);
  });

  it("scope, resource and response_type errors go back to the assistant with state and iss", async () => {
    const noResource = without(params, "resource");
    const cases: [Params, string][] = [
      [{ ...params, scope: "search:write" }, "invalid_scope"],
      [{ ...params, scope: "search:read openid" }, "invalid_scope"],
      [noResource, "invalid_target"],
      [{ ...params, resource: "https://evil.example/mcp" }, "invalid_target"],
      [{ ...params, response_type: "token" }, "unsupported_response_type"],
    ];
    for (const [search, error] of cases) {
      const url = new URL(await redirectOf(() => render(search)));
      expect(Object.fromEntries(url.searchParams)).toEqual({ error, state: "st-123", iss: ISSUER });
    }
  });

  it("a state over 500 characters is not echoed", async () => {
    const url = new URL(await redirectOf(() => render({ ...params, state: "s".repeat(501) })));
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "invalid_request", iss: ISSUER });
  });

  it("missing scope means search:read", async () => {
    await openConnectWindow(agent.id, sessionId);
    const noScope = without(params, "scope");
    expect(await render(noScope)).toMatch(/>Allow</);
  });

  it("over 120 page loads from one IP in 15 minutes → refused before the client is looked up", async () => {
    await seedRateLimit(`ai-authorize:ip:${IP}`, 120, 15 * 60 * 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const html = await render({ ...params, client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata" });
    expect(html).toContain("Too many connection requests");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("an admin session never sees the consent page", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    await signIn(admin.id);
    expect(await redirectOf(() => render(params))).toBe("/login");
  });
});

describe("Allow and Deny", () => {
  it("Allow → one code, redirect with code, state and iss; audit ai.connect; the window is spent", async () => {
    await openConnectWindow(agent.id, sessionId);
    const url = new URL(await redirectOf(() => allowAction(null, formOf(params))));
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_REDIRECT);
    expect([...url.searchParams.keys()].sort()).toEqual(["code", "iss", "state"]);
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("iss")).toBe(ISSUER);
    const code = url.searchParams.get("code")!;
    const row = await db.aiAuthCode.findFirstOrThrow();
    expect(row.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(row).toMatchObject({ userId: agent.id, clientId, redirectUri: CLAUDE_REDIRECT, codeChallenge: params.code_challenge, resource: RESOURCE });
    const audits = await db.auditLog.findMany({ where: { action: "ai.connect" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: agent.id, targetType: "AiClient", targetId: clientId, after: { assistant: "Claude" } });
    expect(JSON.stringify(audits[0])).not.toContain(code);

    // Second Allow: refused, no second code.
    expect(await allowAction(null, formOf(params))).toEqual({ error: NO_WINDOW });
    expect(await db.aiAuthCode.count()).toBe(1);
  });

  it("Allow without a state → no state in the redirect", async () => {
    await openConnectWindow(agent.id, sessionId);
    const noState = without(params, "state");
    const url = new URL(await redirectOf(() => allowAction(null, formOf(noState))));
    expect([...url.searchParams.keys()].sort()).toEqual(["code", "iss"]);
  });

  it("Allow with no window (phishing link) → no code", async () => {
    expect(await allowAction(null, formOf(params))).toEqual({ error: NO_WINDOW });
    expect(await db.aiAuthCode.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "ai.connect" } })).toBe(0);
  });

  it("Allow re-checks every field: tampered ones issue nothing and leave the window open", async () => {
    await openConnectWindow(agent.id, sessionId);
    for (const fields of [
      { ...params, redirect_uri: "https://evil.example/cb" },
      { ...params, redirect_uri: CHATGPT_REDIRECT },
      { ...params, client_id: "unknown" },
      { ...params, scope: "search:write" },
      { ...params, resource: "https://evil.example/mcp" },
      { ...params, code_challenge_method: "plain" },
      { ...params, extra: "1" },
    ]) {
      const result = await allowAction(null, formOf(fields));
      expect(result).toEqual({ error: expect.stringContaining("This connection link does not work") });
    }
    expect(await db.aiAuthCode.count()).toBe(0);
    expect(await db.aiConnectWindow.count({ where: { usedAt: null } })).toBe(1);
  });

  // With JavaScript on, React puts its own hidden inputs into a useActionState form and they
  // reach the action in its FormData.
  const REACT_FIELDS = { $ACTION_REF_1: "", "$ACTION_1:0": '{"id":"abc","bound":"$@1"}', "$ACTION_1:1": "[]", $ACTION_KEY: "k1" };

  it("Allow and Deny accept React's own $ACTION_ fields", async () => {
    await openConnectWindow(agent.id, sessionId);
    const allowed = new URL(await redirectOf(() => allowAction(null, formOf({ ...params, ...REACT_FIELDS }))));
    expect(allowed.searchParams.get("code")).toBeTruthy();
    const denied = new URL(await redirectOf(() => denyAction(formOf({ ...params, ...REACT_FIELDS }))));
    expect(denied.searchParams.get("error")).toBe("access_denied");
  });

  it("any other extra field is still refused, next to React's fields", async () => {
    await openConnectWindow(agent.id, sessionId);
    for (const extra of [{ ACTION_x: "1" }, { $action: "1" }, { "x$ACTION_": "1" }]) {
      const result = await allowAction(null, formOf({ ...params, ...REACT_FIELDS, ...extra }));
      expect(result).toEqual({ error: expect.stringContaining("This connection link does not work") });
      await expect(denyAction(formOf({ ...params, ...REACT_FIELDS, ...extra }))).resolves.toBeUndefined();
    }
    expect(await db.aiAuthCode.count()).toBe(0);
  });

  it("Allow counts against the per-IP authorize limit: the 121st is refused, no code", async () => {
    await openConnectWindow(agent.id, sessionId);
    await seedRateLimit(`ai-authorize:ip:${IP}`, 120, 15 * 60 * 1000);
    expect(await allowAction(null, formOf(params))).toEqual({ error: expect.stringContaining("Too many connection requests") });
    expect(await db.aiAuthCode.count()).toBe(0);
    expect(await db.aiConnectWindow.count({ where: { usedAt: null } })).toBe(1);
  });

  it("Deny → error=access_denied with state and iss, no code", async () => {
    await openConnectWindow(agent.id, sessionId);
    const url = new URL(await redirectOf(() => denyAction(formOf(params))));
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "access_denied", state: "st-123", iss: ISSUER });
    expect(await db.aiAuthCode.count()).toBe(0);
  });

  it("Deny never redirects to a URI the client did not register", async () => {
    await expect(denyAction(formOf({ ...params, redirect_uri: "https://evil.example/cb" }))).resolves.toBeUndefined();
  });

  it("an ADMIN session cannot Allow or Deny", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    const adminSession = await signIn(admin.id);
    await openConnectWindow(admin.id, adminSession);
    expect(await redirectOf(() => allowAction(null, formOf(params)))).toBe("/login");
    expect(await redirectOf(() => denyAction(formOf(params)))).toBe("/login");
    expect(await db.aiAuthCode.count()).toBe(0);
  });

  it("off → 404 for both actions", async () => {
    vi.stubEnv("AI_SEARCH_ENABLED", "false");
    await openConnectWindow(agent.id, sessionId);
    await expect(allowAction(null, formOf(params))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(denyAction(formOf(params))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("sign-in return to the authorize request", () => {
  it("signed out → /login?next=<the authorize request>; after password and email code, back on it", async () => {
    jar.clear();
    const target = authorizePath(params);
    const toLogin = await redirectOf(() => render(params));
    expect(toLogin).toBe(`/login?next=${encodeURIComponent(target)}`);

    // The sign-in page carries `next` in a hidden field.
    const loginHtml = decode(renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: target }) })));
    expect(loginHtml).toContain(`name="next" value="${target}"`);

    const toVerify = await redirectOf(() =>
      loginAction(null, formOf({ email: "agent@example.com", password: PASSWORD, next: target })),
    );
    expect(toVerify).toBe(`/login/verify?next=${encodeURIComponent(target)}`);

    const verifyHtml = decode(renderToStaticMarkup(await VerifyPage({ searchParams: Promise.resolve({ next: target }) })));
    expect(verifyHtml).toContain(`name="next" value="${target}"`);

    const text = vi.mocked(sendEmail).mock.calls.at(-1)![0].text;
    const code = /code is (\d{6})/.exec(text)![1]!;
    expect(await redirectOf(() => verifyCodeAction(null, formOf({ code, next: target })))).toBe(target);
  });

  it("a known device goes straight back to the authorize request", async () => {
    jar.clear();
    // Same device as an earlier verified sign-in.
    const { trustDevice, DEVICE_COOKIE } = await import("@/server/auth/signin-code");
    jar.set(DEVICE_COOKIE, await trustDevice(agent.id));
    const target = authorizePath(params);
    expect(await redirectOf(() => loginAction(null, formOf({ email: "agent@example.com", password: PASSWORD, next: target })))).toBe(target);
  });

  it("an expired session keeps next too", async () => {
    await db.session.deleteMany();
    const toLogin = await redirectOf(() => render(params));
    expect(toLogin).toBe(`/login?expired=1&next=${encodeURIComponent(authorizePath(params))}`);
  });

  it("a session waiting for its email code goes to /login/verify with next", async () => {
    jar.set(SESSION_COOKIE, await createSession(agent.id, { verified: false }));
    expect(await redirectOf(() => render(params))).toBe(`/login/verify?next=${encodeURIComponent(authorizePath(params))}`);
  });

  it("any other next is ignored: the usual pages, no hidden field", async () => {
    jar.clear();
    const { trustDevice, DEVICE_COOKIE } = await import("@/server/auth/signin-code");
    jar.set(DEVICE_COOKIE, await trustDevice(agent.id));
    for (const next of ["https://evil.com", "//evil.com", "/search?x=1", "/admin"]) {
      expect(await redirectOf(() => loginAction(null, formOf({ email: "agent@example.com", password: PASSWORD, next })))).toBe("/search");
      const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next }) }));
      expect(html).not.toContain('name="next"');
    }
  });

  it("an admin's sign-in ignores next", async () => {
    jar.clear();
    await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN", passwordHash: await hashPassword(PASSWORD) });
    expect(
      await redirectOf(() => loginAction(null, formOf({ email: "admin@example.com", password: PASSWORD, next: authorizePath(params) }))),
    ).toBe("/admin");
  });
});

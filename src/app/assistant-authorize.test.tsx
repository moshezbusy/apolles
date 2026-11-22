import { createHash, randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { requireAgent } from "@/server/auth/guards";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { createSession, destroyUserSessions } from "@/server/auth/session";
import { ASSISTANT_CLIENTS } from "@/server/assistant/clients";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

const CLAUDE = ASSISTANT_CLIENTS.find((c) => c.name === "Claude")!;
const REDIRECT = CLAUDE.redirectUris[0]!;
const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
const params = {
  response_type: "code",
  client_id: CLAUDE.clientId,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "st-1",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  data.set("$ACTION_ID_x", "next-internal"); // Next.js adds its own fields; they are ignored
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((error as Error).message);
    if (m) return m[1]!;
    throw error;
  }
  throw new Error("expected a redirect");
}

let agencyId: string;
let userId: string;

describe("/oauth/authorize (assistant consent)", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("ASSISTANT_MCP_URL", "http://localhost:3100/mcp");
    vi.mocked(requireAgent).mockReset();
    vi.mocked(redirect).mockClear();
    agencyId = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
    userId = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId })).id;
    await createSession(userId, { verified: true });
    vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is not found while the connector is off", async () => {
    vi.stubEnv("ASSISTANT_MCP_URL", "");
    const { default: Page } = await import("./oauth/authorize/page");
    await expect(Page({ searchParams: Promise.resolve(params) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("checks the agent session and says plainly that it is search only", async () => {
    const { default: Page } = await import("./oauth/authorize/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    expect(requireAgent).toHaveBeenCalledTimes(1);
    expect(html).toContain("Claude");
    expect(html).toContain("Sunrise Travel");
    expect(html).toContain("Search only. Bookings, cancellations and your balance can&#x27;t be reached.");
    expect(html).toContain(`value="${challenge}"`);
  });

  it("shows an error, and never redirects, for an unknown client or redirect URI", async () => {
    const { default: Page } = await import("./oauth/authorize/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...params, redirect_uri: "https://evil.example.com/cb" }) }));
    expect(html).toContain("This sign-in link is not valid.");
    expect(redirect).not.toHaveBeenCalled();
    expect(requireAgent).not.toHaveBeenCalled();
  });

  it("sends a bad request back to the assistant with an OAuth error", async () => {
    const { default: Page } = await import("./oauth/authorize/page");
    const url = await redirectOf(() => Page({ searchParams: Promise.resolve({ ...params, code_challenge_method: "plain" }) }));
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(REDIRECT);
    expect(parsed.searchParams.get("error")).toBe("invalid_request");
    expect(parsed.searchParams.get("state")).toBe("st-1");
  });

  it("Allow: checks the session, issues a one-time code for the session's own agency and returns to the assistant", async () => {
    const { allowAssistantAction } = await import("./oauth/authorize/actions");
    const url = new URL(await redirectOf(() => allowAssistantAction(form({ ...params, agencyId: "someone-else" }))));
    expect(requireAgent).toHaveBeenCalledTimes(1);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("iss")).toBe("http://localhost:3000");
    const code = url.searchParams.get("code")!;
    expect(code.length).toBeGreaterThan(30);
    const rows = await db.assistantAuthCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agencyId, userId, clientId: CLAUDE.clientId, codeChallenge: challenge });
    expect(rows[0]!.codeHash).not.toBe(code);
  });

  it("Allow after the session ended (e.g. a password change a moment ago) issues nothing and goes to sign-in", async () => {
    await destroyUserSessions(userId);
    const { allowAssistantAction } = await import("./oauth/authorize/actions");
    expect(await redirectOf(() => allowAssistantAction(form(params)))).toBe("/login");
    expect(await db.assistantAuthCode.count()).toBe(0);
  });

  it("warns the agent to allow only a connection they started themselves", async () => {
    const { default: Page } = await import("./oauth/authorize/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
    expect(html).toContain("Only allow this if you just pressed Connect in Claude yourself.");
  });

  it("Allow with a tampered redirect URI issues nothing", async () => {
    const { allowAssistantAction } = await import("./oauth/authorize/actions");
    const url = await redirectOf(() => allowAssistantAction(form({ ...params, redirect_uri: "https://evil.example.com/cb" })));
    expect(url).toBe("/search");
    expect(await db.assistantAuthCode.count()).toBe(0);
  });

  it("Cancel: returns access_denied to the assistant and issues nothing", async () => {
    const { denyAssistantAction } = await import("./oauth/authorize/actions");
    const url = new URL(await redirectOf(() => denyAssistantAction(form(params))));
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("code")).toBeNull();
    expect(await db.assistantAuthCode.count()).toBe(0);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/Header";
import { requireAgent } from "@/server/auth/guards";
import { getAgencyProfile, setAgencyLogo } from "@/server/agency-profile";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));
vi.mock("@/server/auth/password-tokens", () => ({ requestResetWithinLimits: vi.fn(async () => {}) }));

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

let agencyA: string;
let agencyB: string;
let agentA: string;

function signInAs(agencyId: string, userId = agentA): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId, agencyId, sessionId: "session-1" });
}

describe("agency settings", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(requireAgent).mockReset();
    agencyA = (await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } })).id;
    agencyB = (await db.agency.create({ data: { name: "Other Agency", country: "US", bankReference: "APL-0002" } })).id;
    agentA = (await createUser({ email: "a@sunrise.example", name: "Dana", role: "AGENT", agencyId: agencyA })).id;
    signInAs(agencyA);
  });

  describe("/settings page", () => {
    it("checks the agent session and shows the agency's saved details", async () => {
      await db.agency.update({ where: { id: agencyA }, data: { email: "office@sunrise.example", phone: "+972 50 123 4567" } });
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(requireAgent).toHaveBeenCalledTimes(1);
      expect(html).toContain('value="Sunrise Travel"');
      expect(html).toContain('value="office@sunrise.example"');
      expect(html).toContain('value="+972 50 123 4567"');
      expect(html).toMatch(/<option value="IL" selected="">Israel<\/option>/);
      expect(html).toContain("PNG or JPEG, at least 300px wide, up to 500 KB.");
      expect(html).not.toContain("Other Agency");
    });

    it("an unknown stored country shows 'Choose a country', never a silent first option", async () => {
      await db.agency.update({ where: { id: agencyA }, data: { country: "UK" } });
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toMatch(/<option value="" disabled="" selected="">Choose a country<\/option>/);
      expect(html).not.toMatch(/<option value="AF" selected="">/);
    });

    it("shows the logo from /settings/logo once there is one", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      const { default: Page } = await import("./(agent)/settings/page");
      const html = renderToStaticMarkup(await Page());
      expect(html).toMatch(/<img[^>]*src="\/settings\/logo\?v=[0-9a-f]{12}"/);
      expect(html).toContain("Remove logo");
    });
  });

  describe("actions", () => {
    it("saves the profile of the session's agency, ignoring any agencyId in the form", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(
        null,
        form({ name: "Sunrise Ltd", email: "a@b.example", phone: "+972501234567", country: "IL", agencyId: agencyB }),
      );
      expect(state).toEqual({ status: "success", message: "Changes saved." });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Ltd", email: "a@b.example" });
      expect(await getAgencyProfile(agencyB)).toMatchObject({ name: "Other Agency", email: null });
    });

    it("returns an error and saves nothing on invalid input", async () => {
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      const state = await updateProfileAction(null, form({ name: "S", email: "x", phone: "1", country: "XX" }));
      expect(state?.status).toBe("error");
      // What the agent typed comes back, so the form can show it again instead of resetting.
      expect(state && "values" in state ? state.values : null).toEqual({ name: "S", email: "x", phone: "1", country: "XX" });
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel" });
    });

    it("uploads a logo for the session's agency and refuses an SVG", async () => {
      const { uploadLogoAction } = await import("./(agent)/settings/actions");
      const ok = await uploadLogoAction(null, form({ logo: new Blob([Uint8Array.from(png(600, 200))], { type: "image/png" }) }));
      expect(ok).toEqual({ status: "success", message: "Logo saved." });
      expect(await db.agencyLogo.count({ where: { agencyId: agencyA } })).toBe(1);

      const svg = new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/png" });
      const bad = await uploadLogoAction(null, form({ logo: svg }));
      expect(bad?.status).toBe("error");
    });

    it("no agent session → redirect to /login, nothing saved", async () => {
      vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
      const { updateProfileAction } = await import("./(agent)/settings/actions");
      await expect(
        updateProfileAction(null, form({ name: "Hacked", email: "a@b.example", phone: "+972501234567", country: "IL" })),
      ).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(await getAgencyProfile(agencyA)).toMatchObject({ name: "Sunrise Travel" });
    });
  });

  describe("GET /settings/logo", () => {
    it("404 when the agency has no logo", async () => {
      const { GET } = await import("./(agent)/settings/logo/route");
      expect((await GET(new Request("http://x/settings/logo"))).status).toBe(404);
    });

    it("serves the session agency's logo with safe headers", async () => {
      const bytes = png(600, 200);
      await setAgencyLogo(agentA, agencyA, bytes);
      const { GET } = await import("./(agent)/settings/logo/route");
      const res = await GET(new Request("http://x/settings/logo"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(res.headers.get("cache-control")).toBe("private, no-cache");
      expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
      expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    });

    it("never serves another agency's logo", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      signInAs(agencyB, "someone-else");
      const { GET } = await import("./(agent)/settings/logo/route");
      expect((await GET(new Request("http://x/settings/logo"))).status).toBe(404);
    });

    it("lets the browser keep the logo when the URL names its exact version", async () => {
      await setAgencyLogo(agentA, agencyA, png(600, 200));
      const sha = (await db.agencyLogo.findUniqueOrThrow({ where: { agencyId: agencyA } })).sha256;
      const { GET } = await import("./(agent)/settings/logo/route");
      const current = await GET(new Request(`http://x/settings/logo?v=${sha.slice(0, 12)}`));
      expect(current.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      const stale = await GET(new Request("http://x/settings/logo?v=000000000000"));
      expect(stale.headers.get("cache-control")).toBe("private, no-cache");
    });
  });

  describe("tabs (screen 20)", () => {
    async function tab(name: string): Promise<string> {
      const { default: Page } = await import("./(agent)/settings/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: name }) }));
    }

    it("shows the five tabs; an unknown tab shows the profile", async () => {
      const html = await tab("nope");
      for (const label of ["Agency profile", "Quote branding", "Preferences", "Balance &amp; top-ups", "Account"]) expect(html).toContain(label);
      expect(html).toContain('value="Sunrise Travel"');
    });

    it("quote branding saves for the session's agency, and the preview uses it", async () => {
      const { updateBrandingAction } = await import("./(agent)/settings/actions");
      const result = await updateBrandingAction(null, form({ displayName: "Sunrise Trips", advisorName: "Dana Cohen", contactPhone: "", advisorEmail: "", defaultLanguage: "HE", brandColor: "#21436b", defaultMessage: "Hi!", agencyId: agencyB }));
      expect(result).toEqual({ status: "success", message: "Changes saved." });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyA } })).toMatchObject({ quoteDisplayName: "Sunrise Trips", quoteBrandColor: "#21436b", defaultQuoteLanguage: "HE" });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyB } })).toMatchObject({ quoteDisplayName: null });
      const html = await tab("branding");
      expect(html).toContain('value="Sunrise Trips"');
      expect(html).toContain("background-color:#21436b");
      const bad = await updateBrandingAction(null, form({ displayName: "x", advisorName: "", contactPhone: "", advisorEmail: "", defaultLanguage: "EN", brandColor: "red", defaultMessage: "" }));
      expect(bad).toMatchObject({ status: "error", values: { brandColor: "red" } });
    });

    it("preferences: the default markup and cancellation terms", async () => {
      const { updateDefaultsAction } = await import("./(agent)/settings/actions");
      expect(await updateDefaultsAction(null, form({ markupType: "FIXED", markupValue: "35.5" }))).toEqual({ status: "success", message: "Changes saved." });
      expect(await db.agency.findUniqueOrThrow({ where: { id: agencyA } })).toMatchObject({ defaultMarkupType: "FIXED", defaultMarkupValue: 3550, defaultShowCancellation: false });
      expect(await tab("preferences")).toContain('value="35.5"');
    });

    it("balance: the balance, the bank details and the agency's reference; no card payment", async () => {
      vi.stubEnv("BANK_DETAILS_BENEFICIARY", "Apolles Ltd");
      const html = await tab("balance");
      vi.unstubAllEnvs();
      expect(html).toContain("USD 0.00");
      expect(html).toContain("APL-0001");
      expect(html).toContain('href="/balance"');
      expect(html).not.toMatch(/card/i);
    });

    it("account: the agent's name and login email, change password and sign out", async () => {
      const html = await tab("account");
      expect(html).toContain("a@sunrise.example");
      expect(html).toContain("Change password");
      expect(html).toContain('action="/logout"');
      const { changePasswordAction } = await import("./(agent)/settings/actions");
      const { requestResetWithinLimits } = await import("@/server/auth/password-tokens");
      expect(await changePasswordAction()).toMatchObject({ status: "success" });
      expect(vi.mocked(requestResetWithinLimits)).toHaveBeenCalledWith("a@sunrise.example", expect.any(String));
    });
  });

  describe("AI assistants tab", () => {
    const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
    async function aiTab(params: Record<string, string> = {}): Promise<string> {
      const { default: Page } = await import("./(agent)/settings/page");
      return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ tab: "ai", ...params }) }));
    }
    async function connection(agencyId: string, userId: string, name: string, extra: { createdAt?: Date; lastUsedAt?: Date | null } = {}) {
      const client = await db.aiClient.create({ data: { name, redirectUris: [REDIRECT_URI] } });
      return db.aiConnection.create({
        data: { userId, agencyId, clientId: client.id, scope: "search:read", resource: "https://mcp.example.test/mcp", ...extra },
      });
    }

    beforeEach(() => {
      vi.stubEnv("AI_SEARCH_ENABLED", "true");
      vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test/");
      vi.stubEnv("APP_URL", "https://app.example.test");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("the tab is hidden when the switch is off, and ?tab=ai then shows the profile", async () => {
      vi.stubEnv("AI_SEARCH_ENABLED", "false");
      const html = await aiTab();
      expect(html).not.toContain("AI assistants");
      expect(html).toContain('value="Sunrise Travel"');
    });

    it("the tab is listed when the switch is on", async () => {
      const { default: Page } = await import("./(agent)/settings/page");
      expect(renderToStaticMarkup(await Page())).toContain('href="/settings?tab=ai"');
    });

    it("empty state, the can / can't lists and the notice, as in mockup 20", async () => {
      const html = await aiTab();
      expect(html).toContain("Search hotels from Claude or ChatGPT. Search only: bookings, cancellations and your balance can&#x27;t be reached from an AI assistant.");
      expect(html).toContain("Connect assistant");
      expect(html).toContain("No assistants connected.");
      for (const t of ["What the assistant can do", "Search hotels and rates", "Open a result in Apolles to book", "What it can&#x27;t do", "Book, cancel or issue vouchers", "See guests or your balance"]) expect(html).toContain(t);
      expect(html).toContain("Revoking disconnects the assistant right away. To book, open the result in Apolles.");
      expect(html).not.toContain("Your connection link");
    });

    it("lists Claude and ChatGPT with UTC dates, 'last used today' / a date / never used, and Revoke", async () => {
      const now = new Date();
      const claude = await connection(agencyA, agentA, "Claude", { createdAt: new Date("2026-11-12T23:30:00Z"), lastUsedAt: now });
      await connection(agencyA, agentA, "ChatGPT", { createdAt: new Date("2026-11-03T08:00:00Z"), lastUsedAt: new Date("2026-11-18T10:00:00Z") });
      await connection(agencyA, agentA, "Other", { createdAt: new Date("2026-11-01T08:00:00Z") });
      const html = await aiTab();
      expect(html).toContain("Connected Nov 12, 2026 · last used today");
      expect(html).toContain("Connected Nov 3, 2026 · last used Nov 18, 2026");
      expect(html).toContain("Connected Nov 1, 2026 · never used");
      expect(html).toContain("AI assistant");
      expect(html.match(/>Revoke</g)).toHaveLength(3);
      expect(html).toContain(`value="${claude.id}"`);
      expect(html).not.toContain("No assistants connected.");
    });

    it("does not list another agency's assistants", async () => {
      const userB = (await createUser({ email: "b@other.example", name: "Ben", role: "AGENT", agencyId: agencyB })).id;
      await connection(agencyB, userB, "ChatGPT");
      expect(await aiTab()).toContain("No assistants connected.");
    });

    it("pages with a Show more link", async () => {
      for (let i = 0; i < 21; i += 1) await connection(agencyA, agentA, "Claude", { createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)) });
      const html = await aiTab();
      expect(html.match(/>Revoke</g)).toHaveLength(20);
      const m = html.match(/href="\/settings\?tab=ai&amp;cursor=([a-z0-9]+)"/);
      expect(m).not.toBeNull();
      const next = await aiTab({ cursor: m![1]! });
      expect(next.match(/>Revoke</g)).toHaveLength(1);
      expect(next).not.toContain("Show more");
      // A made-up cursor falls back to the first page instead of an error page.
      expect((await aiTab({ cursor: "nope" })).match(/>Revoke</g)).toHaveLength(20);
    });

    it("Connect assistant opens a window for this session and redirects to the panel", async () => {
      const { connectAssistantAction } = await import("./(agent)/settings/actions");
      await expect(connectAssistantAction()).rejects.toThrow("NEXT_REDIRECT:/settings?tab=ai&connect=1");
      expect(await db.aiConnectWindow.count({ where: { userId: agentA, sessionId: "session-1", usedAt: null } })).toBe(1);
    });

    it("connect=1 shows the link and the steps for Claude and ChatGPT", async () => {
      const html = await aiTab({ connect: "1" });
      expect(html).toContain("Your connection link");
      expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="https:\/\/mcp\.example\.test\/mcp"/);
      expect(html).toContain("This link works for the next 10 minutes. Start the connection in Claude or ChatGPT now.");
      for (const t of [
        "In Claude, open Settings → Connectors → Add custom connector.",
        "Paste the link above and click Add.",
        "In ChatGPT, open Settings → Connectors (or Apps) and add a custom connector.",
        "Paste the link above as the server URL, with OAuth sign-in.",
      ]) expect(html).toContain(t);
      expect(html.match(/Sign in to Apolles when asked and click Allow\./g)).toHaveLength(2);
    });

    it("Connect assistant without an agent session opens nothing", async () => {
      vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
      const { connectAssistantAction } = await import("./(agent)/settings/actions");
      await expect(connectAssistantAction()).rejects.toThrow("NEXT_REDIRECT:/login");
      expect(await db.aiConnectWindow.count()).toBe(0);
    });

    it("Revoke disconnects the assistant: audit row, and its token stops working", async () => {
      const { exchangeCode, issueAuthCode, verifyAiToken } = await import("@/server/ai/tokens");
      const { createHash, randomBytes } = await import("node:crypto");
      const client = await db.aiClient.create({ data: { name: "Claude", redirectUris: [REDIRECT_URI] } });
      const verifier = randomBytes(32).toString("base64url");
      const resource = "https://mcp.example.test/mcp";
      const code = await issueAuthCode({ userId: agentA, clientId: client.id, redirectUri: REDIRECT_URI, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource });
      const pair = await exchangeCode({ code, clientId: client.id, redirectUri: REDIRECT_URI, codeVerifier: verifier, resource });
      if (!("accessToken" in pair)) throw new Error("exchange failed");
      expect(await verifyAiToken(pair.accessToken, resource)).not.toBeNull();
      const conn = await db.aiConnection.findFirstOrThrow({ where: { userId: agentA } });

      const { revokeAssistantAction } = await import("./(agent)/settings/actions");
      await expect(revokeAssistantAction(form({ connectionId: conn.id }))).rejects.toThrow("NEXT_REDIRECT:/settings?tab=ai&revoked=1");
      expect(await verifyAiToken(pair.accessToken, resource)).toBeNull();
      expect(await db.auditLog.count({ where: { action: "ai.revoke", targetId: conn.id } })).toBe(1);
      expect(await aiTab({ revoked: "1" })).toContain("Assistant disconnected.");
    });

    it("Revoke of another agency's connection changes nothing; bad ids are ignored", async () => {
      const userB = (await createUser({ email: "b@other.example", name: "Ben", role: "AGENT", agencyId: agencyB })).id;
      const theirs = await connection(agencyB, userB, "ChatGPT");
      const { revokeAssistantAction } = await import("./(agent)/settings/actions");
      await expect(revokeAssistantAction(form({ connectionId: theirs.id }))).rejects.toThrow("NEXT_REDIRECT:/settings?tab=ai&revoked=1");
      await expect(revokeAssistantAction(form({ connectionId: "../x'; DROP" }))).rejects.toThrow("NEXT_REDIRECT:/settings?tab=ai&revoked=1");
      expect((await db.aiConnection.findUniqueOrThrow({ where: { id: theirs.id } })).revokedAt).toBeNull();
      expect(await db.auditLog.count({ where: { action: "ai.revoke" } })).toBe(0);
    });
  });

  it("the agent area has an error page with a way back (e.g. an upload over the 1 MB limit)", async () => {
    const { default: AgentError } = await import("./(agent)/error");
    const html = renderToStaticMarkup(<AgentError error={new Error("x")} reset={() => {}} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).not.toContain("x</");
  });

  it("the header's agency menu links to Agency settings", () => {
    const html = renderToStaticMarkup(<Header agencyName="Sunrise Travel" balanceCents={0} />);
    expect(html).toMatch(/<a[^>]*href="\/settings"[^>]*>Agency settings<\/a>/);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { credit } from "@/server/wallet/ledger";
import { exchangeCode, issueAuthCode, verifyAiToken } from "@/server/ai/tokens";

// Plan 11, task 7: a valid search:read token opens the AI search API and nothing else. Sent to
// any agent or admin endpoint (as a Bearer header, as the session cookie, or as a form field)
// it is treated like an anonymous request: a redirect to /login, no data, no row changed.

// The request the code under test sees: next/headers reads from these two.
const requestHeaders = { current: new Headers() };
const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    has: (name: string) => cookieJar.has(name),
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    set: () => {
      throw new Error("an endpoint tried to set a cookie for a search token");
    },
    delete: () => {
      throw new Error("an endpoint tried to delete a cookie for a search token");
    },
  }),
  headers: async () => requestHeaders.current,
}));

// Like the real redirect(), the mock throws (with Next's digest) so code after it never runs.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROOT = resolve(__dirname, "../../..");
const SRC = join(ROOT, "src");
const APP = join(SRC, "app");
const AI_API = join(APP, "api", "ai");
const RESOURCE = "https://mcp.example.test/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const SERVICE_KEY = "test-service-key-0123456789-abcdef"; // at least 32 characters (F9)

// ---------- helpers ----------

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const rel = (path: string) => relative(ROOT, path).split(sep).join("/");
const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isUnder = (path: string, dir: string) => path.startsWith(dir + sep);

// The /login path a redirect went to. Anything else thrown (or no throw at all) fails the test:
// it means the endpoint did something before (or instead of) refusing the caller.
async function loginRedirectOf(run: () => Promise<unknown>): Promise<string> {
  let result: unknown;
  try {
    result = await run();
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2]!;
    throw error;
  }
  throw new Error(`no redirect; the endpoint answered ${result instanceof Response ? `HTTP ${result.status}` : JSON.stringify(result)}`);
}

// Plain sign-in only: "/login" or "/login?…". Not /login/verify (that would mean the token was
// taken for a session waiting for its email code) and not /admin/2fa.
const SIGN_IN = /^\/login(\?|$)/;

type Seeded = Awaited<ReturnType<typeof seed>>;

// An agent with a real search token, and some agency data a leak would show or change.
async function seed() {
  const agency = await db.agency.create({ data: { name: "Sunrise Travel", country: "IL", bankReference: "APL-0001" } });
  const user = await createUser({ email: "agent@example.com", name: "Agent Smith", role: "AGENT", agencyId: agency.id });
  const aiClient = await db.aiClient.create({ data: { name: "Claude", redirectUris: [REDIRECT] } });
  const verifier = randomBytes(32).toString("base64url");
  const code = await issueAuthCode({
    userId: user.id,
    clientId: aiClient.id,
    redirectUri: REDIRECT,
    codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: RESOURCE,
  });
  const pair = await exchangeCode({ code, clientId: aiClient.id, redirectUri: REDIRECT, codeVerifier: verifier, resource: RESOURCE });
  if (!("accessToken" in pair)) throw new Error("no token");

  await credit({ agencyId: agency.id, type: "TOPUP_BANK", amountCents: 500_000, reason: "test", idempotencyKey: "seed" });
  const client = await db.client.create({
    data: { agencyId: agency.id, firstName: "Dana", lastName: "Levi", phone: "050-1234567", phoneDigits: "501234567", nationality: "IL" },
  });
  // A quote already shared with the client: its link is public (/q/<shareToken>).
  const shareToken = randomBytes(24).toString("base64url");
  const quote = await db.quote.create({
    data: { agencyId: agency.id, createdById: user.id, clientId: client.id, shareToken, status: "SENT", sentAt: new Date() },
  });
  return {
    userId: user.id,
    agencyId: agency.id,
    token: pair.accessToken,
    refreshToken: pair.refreshToken,
    clientId: client.id,
    quoteId: quote.id,
    shareToken,
  };
}

// A real, verified agent session of the seeded agent (positive control).
function signInAgent(rawSession: string): void {
  cookieJar.clear();
  cookieJar.set(SESSION_COOKIE, rawSession);
  requestHeaders.current = new Headers({ cookie: `${SESSION_COOKIE}=${rawSession}`, "x-forwarded-for": "198.51.100.20" });
}

// The full rows, so a changed view count or status shows, not only a changed number of rows.
async function quoteAndClientRows() {
  return {
    quotes: await db.quote.findMany({ orderBy: { id: "asc" } }),
    clients: await db.client.findMany({ orderBy: { id: "asc" } }),
  };
}

async function counts() {
  return {
    booking: await db.booking.count(),
    ledgerEntry: await db.ledgerEntry.count(),
    client: await db.client.count(),
    quote: await db.quote.count(),
    auditLog: await db.auditLog.count(),
    aiConnection: await db.aiConnection.count(),
    aiToken: await db.aiToken.count(),
    session: await db.session.count(),
  };
}

// The two ways a stolen or misused search token could be sent to an app endpoint.
type Carrier = "bearer header" | "session cookie";
const CARRIERS: Carrier[] = ["bearer header", "session cookie"];

function sendAs(carrier: Carrier, token: string): Headers {
  cookieJar.clear();
  const h = new Headers({ "user-agent": "Claude-User", "x-forwarded-for": "198.51.100.20" });
  if (carrier === "bearer header") {
    h.set("authorization", `Bearer ${token}`);
  } else {
    cookieJar.set(SESSION_COOKIE, token);
    h.set("cookie", `${SESSION_COOKIE}=${token}`);
  }
  requestHeaders.current = h;
  return h;
}

// A form that also carries the token in every field name a careless handler might read, and
// the ids of real rows, so a missing guard would touch real data.
function formFor(s: Seeded): FormData {
  const f = new FormData();
  for (const name of ["token", "access_token", "accessToken", "session", SESSION_COOKIE]) f.set(name, s.token);
  for (const name of ["id", "bookingId", "quoteId"]) f.set(name, s.quoteId);
  f.set("clientId", s.clientId);
  f.set("amount", "100.00");
  f.set("reason", "test");
  return f;
}

let s: Seeded;

beforeEach(async () => {
  await resetTestDb();
  vi.stubEnv("AI_SEARCH_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://app.example.test/");
  vi.stubEnv("MCP_PUBLIC_URL", "https://mcp.example.test");
  vi.stubEnv("AI_MCP_SERVICE_KEY", SERVICE_KEY);
  cookieJar.clear();
  requestHeaders.current = new Headers();
  s = await seed();
  // The token under test really is a valid search token.
  expect(await verifyAiToken(s.token, RESOURCE)).not.toBeNull();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------- 1. Structure: only the AI API knows search tokens ----------

describe("only the AI API accepts a search token", () => {
  const appFiles = walk(APP).filter((f) => /\.tsx?$/.test(f) && !isTest(f));
  const knowsSearchTokens = (text: string) => /server\/ai\/search-api|\bverifyAiToken\b/.test(text);

  it("the route, action, page and layout files it scans exist", () => {
    for (const name of ["route.ts", "actions.ts", "page.tsx", "layout.tsx"]) {
      expect(appFiles.some((f) => f.endsWith(sep + name)), name).toBe(true);
    }
    expect(appFiles.filter((f) => isUnder(f, AI_API)).length).toBeGreaterThanOrEqual(2);
  });

  it("no app file outside src/app/api/ai/ imports the search API or checks a search token", () => {
    const offenders = appFiles.filter((f) => !isUnder(f, AI_API) && knowsSearchTokens(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("outside src/server/ai/, no server code checks a search token", () => {
    const offenders = walk(join(SRC, "server"))
      .filter((f) => /\.tsx?$/.test(f) && !isTest(f) && !isUnder(f, join(SRC, "server", "ai")))
      .filter((f) => knowsSearchTokens(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  // Only the AI API reads a token from the Authorization header (and the OAuth endpoints, which
  // may read client credentials from it). Anywhere else, reading it could turn a search token
  // into a key to something more.
  it("outside src/app/api/ai/, src/app/oauth/ and src/server/ai/, no code reads an Authorization header", () => {
    const allowed = [AI_API, join(APP, "oauth"), join(SRC, "server", "ai")];
    const offenders = [...walk(APP), ...walk(join(SRC, "server"))]
      .filter((f) => /\.tsx?$/.test(f) && !isTest(f) && !allowed.some((dir) => isUnder(f, dir)))
      .filter((f) => /["']authorization["']|\.authorization\b/i.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  // Every module the AI API routes load, directly or through other modules.
  function importGraph(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const resolveSpec = (from: string, spec: string): string | null => {
      let base: string;
      if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
      else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
      else return null; // a package, not our code
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
      return null;
    };
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
        const next = resolveSpec(file, m[1]!);
        if (next && !next.includes(`${sep}generated${sep}`)) visit(next);
      }
    };
    entries.forEach(visit);
    return seen;
  }

  const FORBIDDEN = [
    join(SRC, "server", "booking") + sep,
    join(SRC, "server", "wallet") + sep,
    join(SRC, "server", "clients.ts"),
    join(SRC, "server", "quotes") + sep,
  ];
  const forbidden = (f: string) => FORBIDDEN.some((p) => f === p || f.startsWith(p));

  it("no file under src/app/api/ai/ imports booking, wallet, clients or quotes code", () => {
    const routes = walk(AI_API).filter((f) => /\.tsx?$/.test(f) && !isTest(f));
    const direct = routes.filter((f) => /["']@\/server\/(booking|wallet|clients|quotes)(\/|["'])/.test(readFileSync(f, "utf8")));
    expect(direct.map(rel)).toEqual([]);
    // …nor through any module they load.
    const reachable = [...importGraph(routes)];
    expect(reachable.map(rel)).toContain("src/server/ai/search-api.ts");
    expect(reachable.filter(forbidden).map(rel)).toEqual([]);
  });

  it("src/server/ai/search-api.ts itself does not import them", () => {
    const text = readFileSync(join(SRC, "server", "ai", "search-api.ts"), "utf8");
    expect(text).not.toMatch(/["']@\/server\/(booking|wallet|clients|quotes)(\/|["'])/);
    expect(text).not.toMatch(/["']\.\.\/(booking|wallet|clients|quotes)(\/|["'])/);
  });
});

// ---------- 2. Agent GET routes: vouchers, statements, exports, logo, destinations ----------

// Every route.ts behind the agent and admin sign-in, found on disk. A new one fails the test
// below until it is added here (and so tested).
const GUARDED_ROUTE_FILES = [join(APP, "(agent)"), join(APP, "(link)"), join(APP, "admin")].flatMap((dir) => walk(dir).filter((f) => f.endsWith(`${sep}route.ts`)));
const ROUTE_URLS: Record<string, string> = {
  "src/app/(agent)/bookings/[id]/voucher/route.ts": "/bookings/x/voucher",
  "src/app/(agent)/bookings/[id]/statement/route.ts": "/bookings/x/statement",
  "src/app/(agent)/bookings/export/route.ts": "/bookings/export?tab=all",
  "src/app/(agent)/reporting/export/route.ts": "/reporting/export?range=this-month",
  "src/app/(agent)/settings/logo/route.ts": "/settings/logo",
  "src/app/(agent)/search/destinations/route.ts": "/search/destinations?q=par",
};

type GetRoute = { GET: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
const importRoute = async (file: string) => (await import(/* @vite-ignore */ file)) as GetRoute;

describe("agent and admin GET routes refuse a search token", () => {
  it("every route.ts under (agent) and admin is in the tested list", () => {
    expect(GUARDED_ROUTE_FILES.map(rel).sort()).toEqual(Object.keys(ROUTE_URLS).sort());
  });

  for (const file of GUARDED_ROUTE_FILES) {
    const url = ROUTE_URLS[rel(file)] ?? "/";
    for (const carrier of CARRIERS) {
      it(`${rel(file).replace("src/app/", "")} with the token as a ${carrier} → /login, no data`, async () => {
        const mod = await importRoute(file);
        expect(typeof mod.GET).toBe("function");
        const before = await counts();
        const headers = sendAs(carrier, s.token);
        const request = new Request(`https://app.example.test${url}`, { headers });
        const to = await loginRedirectOf(() => mod.GET(request, { params: Promise.resolve({ id: s.quoteId }) }));
        expect(to).toMatch(SIGN_IN);
        expect(await counts()).toEqual(before);
      });
    }
  }
});

// ---------- Positive control: the same harness lets a real session through ----------

describe("positive control: a real signed-in session is not refused by this harness", () => {
  it("agent session cookie: search/destinations answers 200, clearRecentAction goes on to /search", async () => {
    signInAgent(await createSession(s.userId, { verified: true }));
    const destinations = await importRoute(join(APP, "(agent)", "search", "destinations", "route.ts"));
    const res = await destinations.GET(new Request("https://app.example.test/search/destinations?q=par", { headers: requestHeaders.current }), {
      params: Promise.resolve({ id: "" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ destinations: [] });

    const { clearRecentAction } = await import("@/app/(agent)/search/actions");
    expect(await loginRedirectOf(() => clearRecentAction())).toBe("/search");
  });

  it("admin session with TOTP entered: rejectAction passes the guard (answers a form error, not /login)", async () => {
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { totpSecret: "JBSWY3DPEHPK3PXP", totpConfirmedAt: new Date() } });
    const raw = await createSession(admin.id, { verified: true });
    await db.session.updateMany({ where: { userId: admin.id }, data: { totpVerifiedAt: new Date() } });
    signInAgent(raw);
    const { rejectAction } = await import("@/app/admin/applications/actions");
    const f = new FormData();
    f.set("id", "no-such-application");
    const result = await rejectAction(null, f);
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("the real share link: recordViewAction counts a view (so the /q/ checks below would see a change)", async () => {
    const { recordViewAction } = await import("@/app/q/[token]/actions");
    requestHeaders.current = new Headers({ "x-forwarded-for": "198.51.100.20" });
    await recordViewAction(s.shareToken);
    const q = await db.quote.findUniqueOrThrow({ where: { id: s.quoteId } });
    expect(q).toMatchObject({ viewCount: 1, status: "VIEWED" });
  });
});

// ---------- Public client quote link: the search token is not a share token ----------

describe("public quote endpoints (/q/[token]) refuse a search token as the link token", () => {
  for (const carrier of CARRIERS) {
    it(`page, logo and both actions with the search token in the URL (and as a ${carrier}) → not found, nothing changed`, async () => {
      const before = await quoteAndClientRows();
      const beforeCounts = await counts();
      sendAs(carrier, s.token);
      const params = Promise.resolve({ token: s.token });

      const { default: ClientQuotePage } = await import("@/app/q/[token]/page");
      await expect(ClientQuotePage({ params })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

      const logo = await import("@/app/q/[token]/logo/route");
      const res = await logo.GET(new Request(`https://app.example.test/q/${s.token}/logo`, { headers: requestHeaders.current }), { params });
      expect(res.status).toBe(404);

      const { recordViewAction, submitSelectionAction } = await import("@/app/q/[token]/actions");
      expect(await recordViewAction(s.token)).toBeUndefined();
      expect(await submitSelectionAction(s.token, {}, "")).toEqual({ ok: false, error: "gone" });

      expect(await quoteAndClientRows()).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    });
  }
});

// ---------- 3. Every agent and admin server action ----------

// Found on disk, so an action added later is covered without touching this test. (link) holds
// agent pages opened from outside links (the assistant's /search/open), outside (agent) so they
// can send the agent back after sign-in.
const ACTION_FILES = [join(APP, "(agent)"), join(APP, "(link)"), join(APP, "admin")].flatMap((dir) => walk(dir).filter((f) => f.endsWith(`${sep}actions.ts`)));

type Action = (...args: unknown[]) => Promise<unknown>;

async function actionsOf(file: string): Promise<[string, Action][]> {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  return Object.entries(mod).filter((e): e is [string, Action] => typeof e[1] === "function");
}

describe("every agent and admin server action refuses a search token", () => {
  it("finds the booking, cancellation, client, quote, settings, search and admin wallet actions", async () => {
    const files = ACTION_FILES.map(rel);
    for (const f of [
      "src/app/(agent)/book/actions.ts",
      "src/app/(agent)/bookings/[id]/actions.ts",
      "src/app/(agent)/clients/actions.ts",
      "src/app/(agent)/quotes/actions.ts",
      "src/app/(agent)/settings/actions.ts",
      "src/app/(agent)/search/actions.ts",
      "src/app/(link)/search/open/actions.ts",
      "src/app/admin/agencies/[id]/wallet/actions.ts",
      "src/app/admin/agencies/actions.ts",
    ]) {
      expect(files).toContain(f);
    }
    for (const file of ACTION_FILES) expect((await actionsOf(file)).length, rel(file)).toBeGreaterThan(0);
  });

  for (const file of ACTION_FILES) {
    for (const carrier of CARRIERS) {
      it(`${rel(file).replace("src/app/", "")}: every action with the token as a ${carrier} (and in the form) → /login, nothing changed`, async () => {
        const actions = await actionsOf(file);
        const before = await counts();
        const refused: string[] = [];
        for (const [name, action] of actions) {
          // (prevState, formData) and (formData): whichever shape the action has, its guard
          // must fire before it reads any argument.
          for (const args of [[undefined, formFor(s)], [formFor(s)]]) {
            sendAs(carrier, s.token);
            const to = await loginRedirectOf(() => action(...args)).catch((error: unknown) => {
              throw new Error(`${name}(${args.length} args) did not refuse with a redirect to /login: ${String(error)}`);
            });
            expect(to, name).toMatch(SIGN_IN);
          }
          refused.push(name);
        }
        expect(refused).toEqual(actions.map(([name]) => name));
        expect(await counts()).toEqual(before);
        // Nothing was spent or moved, and the token's connection is still the only one.
        expect(await db.ledgerEntry.aggregate({ _sum: { amountCents: true } })).toEqual({ _sum: { amountCents: 500_000 } });
      });
    }
  }
});

// ---------- 4. The AI API itself: a session cookie is not a search token ----------

describe("the AI API does not accept an agent's session cookie", () => {
  it("/api/ai/v1/search and /rates with a valid session cookie and the service key, no Bearer → 401", async () => {
    const searchRoute = await import("@/app/api/ai/v1/search/route");
    const ratesRoute = await import("@/app/api/ai/v1/rates/route");
    const sessionToken = await createSession(s.userId, { verified: true });
    cookieJar.set(SESSION_COOKIE, sessionToken);
    const before = await counts();
    for (const [route, path, body] of [
      [searchRoute, "/api/ai/v1/search", { destination_id: "x", checkin: "2027-04-10", checkout: "2027-04-12", rooms: [{ adults: 2, child_ages: [] }], nationality: "IL" }],
      [ratesRoute, "/api/ai/v1/rates", { search_id: "x", hotel_id: "1" }],
    ] as const) {
      const res = await route.POST(
        new Request(`https://app.example.test${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "198.51.100.20",
            "x-apolles-service-key": SERVICE_KEY,
            cookie: `${SESSION_COOKIE}=${sessionToken}`,
          },
          body: JSON.stringify(body),
        }),
      );
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
    expect(await counts()).toEqual(before);
  });
});

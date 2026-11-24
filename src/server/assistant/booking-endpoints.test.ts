import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE } from "@/server/auth/session";
import { createConnection } from "./connections";

// Owner decision (2026-11-22): a search:read assistant token must be refused by every booking,
// cancellation, voucher, statement, balance and wallet entry point. Those entry points accept only
// the browser session cookie (requireAgent / requireAdmin), so the token is refused whether it is
// sent as "Authorization: Bearer" or even planted as the session cookie. This file calls every
// agent server action and every agent download route with a valid assistant token and checks that
// each one sends the caller to sign in before doing anything.

const RESOURCE = "https://mcp.apolles.test/mcp";
const saved = process.env.MCP_PUBLIC_URL;
const cookieJar = new Map<string, string>();
const requestHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(Object.fromEntries(requestHeaders)),
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: vi.fn(),
    delete: vi.fn(),
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const ROOT = join(import.meta.dirname, "../../..");
const APP = join(ROOT, "src/app");

function files(dir: string, name: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path, name) : name(entry.name) ? [path] : [];
  });
}

// Every server action module of the agent area (bookings, cancel, book, quotes, clients, search,
// settings incl. balance top-up and logo) and every agent route (voucher, statement, exports).
const AGENT_DIR = join(APP, "(agent)");
const agentActionModules = files(AGENT_DIR, (f) => f === "actions.ts");
const agentRoutes = files(AGENT_DIR, (f) => f === "route.ts");

let token = "";
let userId = "";

async function connectedAgent() {
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
  const user = await createUser({ email: "agent@example.com", name: "Agent", role: "AGENT", agencyId: agency.id });
  await db.assistantClient.create({ data: { id: "apc_test", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] } });
  const issued = await db.$transaction((tx) => createConnection(tx, { userId: user.id, agencyId: agency.id, clientId: "apc_test", clientName: "Claude", resource: RESOURCE }, new Date()));
  return { userId: user.id, token: issued.accessToken };
}

function formData(): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({ id: "b1", bookingId: "b1", quoteId: "q1", snapshotId: "s1", propertyId: "1", amount: "100", reason: "x" })) form.set(key, value);
  return form;
}

async function refusedToSignIn(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "ran";
}

describe("a search:read assistant token opens no booking, cancel, voucher, statement, balance or wallet entry point", () => {
  beforeEach(async () => {
    await resetTestDb();
    process.env.MCP_PUBLIC_URL = RESOURCE;
    cookieJar.clear();
    requestHeaders.clear();
    ({ token, userId } = await connectedAgent());
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = saved;
  });

  it("finds the entry points it checks (the list cannot silently go empty)", () => {
    const names = agentActionModules.map((f) => relative(AGENT_DIR, f)).sort();
    expect(names).toEqual(expect.arrayContaining(["book/actions.ts", "bookings/[id]/actions.ts", "settings/actions.ts", "quotes/actions.ts", "clients/actions.ts", "search/actions.ts"]));
    expect(agentRoutes.map((f) => relative(AGENT_DIR, f)).sort()).toEqual(
      expect.arrayContaining(["bookings/[id]/voucher/route.ts", "bookings/[id]/statement/route.ts", "bookings/export/route.ts", "reporting/export/route.ts"]),
    );
  });

  it("requireAgent refuses the token as a Bearer header, and as a planted session cookie", async () => {
    const { requireAgent } = await import("@/server/auth/guards");
    requestHeaders.set("authorization", `Bearer ${token}`);
    expect(await refusedToSignIn(() => requireAgent())).toMatch(/^NEXT_REDIRECT:\/login/);
    cookieJar.set(SESSION_COOKIE, token);
    expect(await refusedToSignIn(() => requireAgent())).toMatch(/^NEXT_REDIRECT:\/login/);
    const { requireAdmin } = await import("@/server/auth/guards");
    expect(await refusedToSignIn(() => requireAdmin())).toMatch(/^NEXT_REDIRECT:\/login/);
  });

  it("every agent server action (book, cancel, change requests, quotes, clients, balance top-up, settings) sends the caller to sign in", async () => {
    requestHeaders.set("authorization", `Bearer ${token}`);
    cookieJar.set(SESSION_COOKIE, token);
    let checked = 0;
    for (const file of agentActionModules) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const [name, action] of Object.entries(mod)) {
        if (typeof action !== "function") continue;
        const run = action as (...args: unknown[]) => Promise<unknown>;
        // (previous state, form) for form actions; (form) for plain ones.
        const first = await refusedToSignIn(() => run({ status: "idle" }, formData()));
        const outcome = /^NEXT_REDIRECT:\/login/.test(first) ? first : await refusedToSignIn(() => run(formData()));
        expect(outcome, `${relative(APP, file)} ${name}`).toMatch(/^NEXT_REDIRECT:\/login/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // Nothing was written on the agent's behalf.
    expect(await db.booking.count()).toBe(0);
    expect(await db.auditLog.count({ where: { actorUserId: userId, NOT: { action: "assistant.connect" } } })).toBe(0);
  });

  it("every agent download and list route (voucher, statement, bookings and report exports, logo, suggestions) sends the caller to sign in", async () => {
    requestHeaders.set("authorization", `Bearer ${token}`);
    for (const file of agentRoutes) {
      const mod = (await import(file)) as { GET?: (r: Request, c: unknown) => Promise<Response> };
      expect(mod.GET, relative(APP, file)).toBeTypeOf("function");
      const request = new Request("http://localhost:3000/x?q=paris", { headers: { authorization: `Bearer ${token}` } });
      const outcome = await refusedToSignIn(() => mod.GET!(request, { params: Promise.resolve({ id: "b1" }) }));
      expect(outcome, relative(APP, file)).toMatch(/^NEXT_REDIRECT:\/login/);
    }
  });

  it("only the assistant search API reads assistant tokens: no other code reads an Authorization header", () => {
    const allowed = new Set(["src/server/assistant/api.ts", "src/mcp/server.ts"]);
    const sources = [...files(join(ROOT, "src"), (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))];
    for (const file of sources) {
      const rel = relative(ROOT, file);
      if (rel.startsWith("src/generated/")) continue;
      const text = readFileSync(file, "utf8");
      if (/get\(\s*["']authorization["']\s*\)/i.test(text)) expect(allowed.has(rel), rel).toBe(true);
      if (/verifyAccessToken/.test(text)) expect(["src/server/assistant/api.ts", "src/server/assistant/connections.ts"], rel).toContain(rel);
    }
  });
});

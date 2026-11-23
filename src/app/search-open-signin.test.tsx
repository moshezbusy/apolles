import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";

// F2 (plan 11 final review): an agent who opens an assistant's result link while signed out must
// come back to that link after sign-in and the email code. The real guards run here (only the
// cookie jar and redirect are fake), through the layout the page really renders in.

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "TestBrowser/1.0" }),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
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

const APP = join(process.cwd(), "src", "app");
const IN = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const OUT = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
const PARAMS = { in: IN, out: OUT, rooms: "2", hotel: "11", destId: "paris" };
const RETURN_TO = `/search/open?${new URLSearchParams(PARAMS).toString()}`;
const NEXT = `next=${encodeURIComponent(RETURN_TO)}`;

// What Next does for /search/open: the group's layout and the page render together. A layout
// that redirects first (without `next`) would win, so it must never redirect.
async function renderLinkPage(): Promise<string> {
  const { default: Layout } = await import("./(link)/layout");
  const { default: Page } = await import("./(link)/search/open/page");
  const page = await Page({ searchParams: Promise.resolve({ ...PARAMS }) });
  return renderToStaticMarkup(await Layout({ children: page }));
}

async function agent(verified: boolean): Promise<void> {
  const agency = await db.agency.create({ data: { id: "A", name: "Agency A", country: "IL", bankReference: "APL-A" } });
  const user = await createUser({ email: "agent@example.com", name: "A", role: "AGENT", agencyId: agency.id });
  jar.set(SESSION_COOKIE, await createSession(user.id, { verified }));
}

describe("/search/open sign-in return (F2)", () => {
  beforeEach(async () => {
    await resetTestDb();
    jar.clear();
  });

  it("lives outside the (agent) group, whose layout redirects without a return address", () => {
    expect(existsSync(join(APP, "(link)", "search", "open", "page.tsx"))).toBe(true);
    expect(existsSync(join(APP, "(link)", "search", "open", "actions.ts"))).toBe(true);
    expect(existsSync(join(APP, "(agent)", "search", "open"))).toBe(false);
  });

  it("the (link) layout never redirects: with no session it renders the page alone", async () => {
    const { default: Layout } = await import("./(link)/layout");
    const html = renderToStaticMarkup(await Layout({ children: <p>page body</p> }));
    expect(html).toBe("<p>page body</p>");
  });

  it("no session → /login with next set to the same link", async () => {
    await expect(renderLinkPage()).rejects.toThrow(`NEXT_REDIRECT:/login?${NEXT}`);
  });

  it("a session waiting for its email code → /login/verify with next set to the same link", async () => {
    await agent(false);
    await expect(renderLinkPage()).rejects.toThrow(`NEXT_REDIRECT:/login/verify?${NEXT}`);
  });

  it("a signed-in agent gets the same header as every agent page", async () => {
    await agent(true);
    await db.destination.create({
      data: { id: "paris", name: "Paris", nameFull: "Paris, France", type: "city", countryCode: "FR", propertyCount: 1, seenRunId: "r" },
    });
    await db.property.create({ data: { id: "11", name: "Hotel 11", city: "Paris", countryCode: "FR", rank: 1, expediaCollect: true, active: true, catalogSeenRunId: "r" } });
    const html = await renderLinkPage();
    expect(html).toContain("Agency A"); // the agent header
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Hotel 11");
    expect(html).toContain("Show rates");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import AgentError from "./(agent)/error";
import RootError from "./error";
import NotFound from "./not-found";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));

describe("system states (screen 24)", () => {
  beforeEach(() => jar.clear());

  it("404 offers search and bookings", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("We couldn&#x27;t find this page");
    expect(html).toContain('href="/search"');
    expect(html).toContain('href="/bookings"');
  });

  it("an error never shows its message, warns against booking twice, and shows the code", () => {
    const html = renderToStaticMarkup(<AgentError error={Object.assign(new Error("db password=hunter2"), { digest: "7F3K21ABCDEF99" })} reset={() => undefined} />);
    expect(html).not.toContain("hunter2");
    expect(html).toContain("so you don&#x27;t book twice");
    expect(html).toContain("Error code: 7F3K21ABCDEF");
  });

  it("an error outside the agent area shows no message and no link into the agent area", () => {
    const html = renderToStaticMarkup(<RootError error={Object.assign(new Error("secret=xyz"), { digest: "ABCDEF123456" })} reset={() => undefined} />);
    expect(html).not.toContain("xyz");
    expect(html).not.toContain('href="/bookings"');
    expect(html).toContain("Error code: ABCDEF123456");
  });

  it("404 says bookings and quotes are safe", async () => {
    expect(renderToStaticMarkup(await NotFound())).toContain("Your bookings and quotes are safe.");
  });

  it("404 for a signed-in admin links into the admin area, not the agent pages", async () => {
    await resetTestDb();
    await db.user.create({ data: { id: "adm", email: "admin@example.com", name: "Admin", role: "ADMIN" } });
    jar.set(SESSION_COOKIE, await createSession("adm", { verified: true }));
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/bookings"');
    expect(html).not.toContain('href="/search"');
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession, getSession } from "@/server/auth/session";
import { POST } from "@/app/logout/route";

function logoutRequest(headers: Record<string, string>, token?: string): NextRequest {
  const all: Record<string, string> = { host: "app.example.com", ...headers };
  if (token !== undefined) all.cookie = `${SESSION_COOKIE}=${token}`;
  return new NextRequest("https://app.example.com/logout", { method: "POST", headers: all });
}

describe("POST /logout", () => {
  let token: string;
  let other: string;

  beforeEach(async () => {
    await resetTestDb();
    const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
    token = await createSession(admin.id);
    other = await createSession(admin.id);
  });

  it("same origin → deletes this session only, clears the cookie, 303 to /login", async () => {
    const res = await POST(logoutRequest({ origin: "https://app.example.com" }, token));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);

    expect(await getSession(token)).toBeNull();
    expect(await getSession(other)).not.toBeNull();
    expect(await db.session.count()).toBe(1);
  });

  it("cross-origin → 403 and the session survives", async () => {
    const res = await POST(logoutRequest({ origin: "https://evil.example.net" }, token));
    expect(res.status).toBe(403);
    expect(await getSession(token)).not.toBeNull();
  });

  it("missing Origin header → 403", async () => {
    const res = await POST(logoutRequest({}, token));
    expect(res.status).toBe(403);
    expect(await getSession(token)).not.toBeNull();
  });

  it("same origin without a cookie → still 303 to /login", async () => {
    const res = await POST(logoutRequest({ origin: "https://app.example.com" }));
    expect(res.status).toBe(303);
    expect(await db.session.count()).toBe(2);
  });
});

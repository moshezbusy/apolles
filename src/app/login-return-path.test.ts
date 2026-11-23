import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { hashPassword } from "@/server/auth/password";
import { createSession, getSession, SESSION_COOKIE } from "@/server/auth/session";
import { DEVICE_COOKIE, sendSignInCode, trustDevice } from "@/server/auth/signin-code";
import { loginAction } from "./login/actions";
import { verifyCodeAction } from "./login/verify/actions";

// After a session ends the agent signs in again and lands back on the page they were on
// (`next`), through the email-code step too. Only a path on this site is followed.

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
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
}));
vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));
const sent: { text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { text: string }) => {
    sent.push(m);
  }),
}));

const GOOD = "abcdefg1";
let passwordHash: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function agent() {
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
  return createUser({ email: "agent@example.com", name: "A", role: "AGENT", agencyId: agency.id, passwordHash });
}

describe("sign-in returns to the page the agent was on", () => {
  beforeEach(async () => {
    passwordHash ??= await hashPassword(GOOD);
    await resetTestDb();
    jar.clear();
    sent.length = 0;
  });

  it("known device: straight back to `next`", async () => {
    const user = await agent();
    jar.set(DEVICE_COOKIE, await trustDevice(user.id));
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD, next: "/bookings?status=CONFIRMED" }))).rejects.toThrow(
      /^NEXT_REDIRECT:\/bookings\?status=CONFIRMED$/,
    );
  });

  it("a path to another site is ignored: the search page as usual", async () => {
    const user = await agent();
    jar.set(DEVICE_COOKIE, await trustDevice(user.id));
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD, next: "//evil.example/x" }))).rejects.toThrow(/^NEXT_REDIRECT:\/search$/);
  });

  it("new device: `next` goes through the email-code step, and the right code lands there", async () => {
    await agent();
    await expect(loginAction(null, form({ email: "agent@example.com", password: GOOD, next: "/clients" }))).rejects.toThrow(
      /^NEXT_REDIRECT:\/login\/verify\?next=%2Fclients$/,
    );
    const code = /code is (\d{6})/.exec(sent.at(-1)!.text)![1]!;
    await expect(verifyCodeAction(null, form({ code, next: "/clients" }))).rejects.toThrow(/^NEXT_REDIRECT:\/clients$/);
  });

  it("the code step ignores an unsafe `next` too", async () => {
    const user = await agent();
    const token = await createSession(user.id, { verified: false });
    jar.set(SESSION_COOKIE, token);
    await sendSignInCode((await getSession(token))!.sessionId);
    const code = /code is (\d{6})/.exec(sent.at(-1)!.text)![1]!;
    await expect(verifyCodeAction(null, form({ code, next: "https://evil.example" }))).rejects.toThrow(/^NEXT_REDIRECT:\/search$/);
  });
});

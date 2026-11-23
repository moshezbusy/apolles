import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, createSession, getSession } from "@/server/auth/session";
import { DEVICE_COOKIE, isTrustedDevice, sendSignInCode } from "@/server/auth/signin-code";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { verifyCodeAction } from "./login/verify/actions";

// The email-code step end to end (real database): a right code completes the sign-in and
// replaces the session token, so the cookie from before the code no longer opens anything.

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      jar.set(name, value);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
const sent: { text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { text: string }) => {
    sent.push(m);
  }),
}));

function form(code: string): FormData {
  const fd = new FormData();
  fd.set("code", code);
  return fd;
}

async function pendingAgent(): Promise<{ before: string; code: string }> {
  await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u1", email: "dana@agency.example", name: "Dana", role: "AGENT", agencyId: "A" } });
  const before = await createSession("u1", { verified: false });
  jar.set(SESSION_COOKIE, before);
  await sendSignInCode((await getSession(before))!.sessionId);
  return { before, code: /code is (\d{6})/.exec(sent.at(-1)!.text)![1]! };
}

describe("verifyCodeAction", () => {
  beforeEach(async () => {
    await resetTestDb();
    setCalls.length = 0;
    jar.clear();
    sent.length = 0;
  });

  it("right code → signed in with a new session token, the device is remembered, on to /search", async () => {
    const { before, code } = await pendingAgent();
    await expect(verifyCodeAction(null, form(code))).rejects.toThrow("NEXT_REDIRECT:/search");

    const session = setCalls.find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session!.value).not.toBe(before);
    expect(session!.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(session!.options).not.toHaveProperty("domain");
    expect(await getSession(before)).toBeNull();
    expect((await getSession(session!.value))?.emailVerifiedAt).not.toBeNull();
    expect(await db.session.count()).toBe(1);

    const device = setCalls.find((c) => c.name === DEVICE_COOKIE);
    expect(await isTrustedDevice("u1", device?.value)).toBe(true);
  });

  it("wrong code → the same session keeps waiting, no cookie is changed", async () => {
    const { before, code } = await pendingAgent();
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await verifyCodeAction(null, form(wrong))).toEqual({ error: "That code is not right. Check the email and try again." });
    expect(setCalls).toHaveLength(0);
    expect((await getSession(before))?.emailVerifiedAt).toBeNull();
  });
});

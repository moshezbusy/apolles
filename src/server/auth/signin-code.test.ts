import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { resetTestDb } from "@/test/db";
import { createSession, getSession } from "./session";
import { MAX_CODE_ATTEMPTS, forgetDevices, isTrustedDevice, sendSignInCode, trustDevice, verifySignInCode } from "./signin-code";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email/port", () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  }),
}));

async function agentSession(): Promise<{ sessionId: string; token: string }> {
  await db.agency.create({ data: { id: "A", name: "A", country: "IL", bankReference: "APL-A" } });
  await db.user.create({ data: { id: "u1", email: "dana@agency.example", name: "Dana", role: "AGENT", agencyId: "A" } });
  const token = await createSession("u1", { verified: false });
  const s = await getSession(token);
  return { sessionId: s!.sessionId, token };
}

function codeOf(): string {
  return /code is (\d{6})/.exec(sent.at(-1)!.text)![1]!;
}

beforeEach(async () => {
  await resetTestDb();
  sent.length = 0;
});

describe("sign-in code on a new device (plan 8e)", () => {
  it("emails a 6-digit code; the right one verifies the session; nothing in the email but the code", async () => {
    const { sessionId, token } = await agentSession();
    expect((await getSession(token))!.emailVerifiedAt).toBeNull();
    expect(await sendSignInCode(sessionId)).toBe("sent");
    expect(sent[0]).toMatchObject({ to: "dana@agency.example", subject: "Your Apolles sign-in code" });
    expect(await verifySignInCode(sessionId, "000000" === codeOf() ? "111111" : "000000")).toBe("wrong");
    expect(await verifySignInCode(sessionId, codeOf())).toBe("ok");
    expect((await getSession(token))!.emailVerifiedAt).not.toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).codeHash).toBeNull();
  });

  it("expires after 10 minutes; 5 wrong codes end the session; at most 3 codes per sign-in", async () => {
    const { sessionId, token } = await agentSession();
    const now = new Date();
    await sendSignInCode(sessionId, now);
    expect(await verifySignInCode(sessionId, codeOf(), new Date(now.getTime() + 11 * 60_000))).toBe("expired");
    expect(await sendSignInCode(sessionId)).toBe("sent");
    expect(await sendSignInCode(sessionId)).toBe("sent");
    expect(await sendSignInCode(sessionId)).toBe("limited");
    const right = codeOf();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) expect(await verifySignInCode(sessionId, wrong)).toBe("wrong");
    expect(await verifySignInCode(sessionId, wrong)).toBe("locked");
    expect(await getSession(token)).toBeNull();
    expect(await verifySignInCode(sessionId, right)).toBe("locked");
  });

  it("a known device is the user's own, not expired, and forgotten on a password change", async () => {
    await agentSession();
    await db.user.create({ data: { id: "u2", email: "other@agency.example", name: "O", role: "AGENT", agencyId: "A" } });
    const raw = await trustDevice("u1");
    expect(await isTrustedDevice("u1", raw)).toBe(true);
    expect(await isTrustedDevice("u2", raw)).toBe(false);
    expect(await isTrustedDevice("u1", raw, new Date(Date.now() + 91 * 86_400_000))).toBe(false);
    expect(await isTrustedDevice("u1", "nope")).toBe(false);
    await forgetDevices("u1");
    expect(await isTrustedDevice("u1", raw)).toBe(false);
  });
});

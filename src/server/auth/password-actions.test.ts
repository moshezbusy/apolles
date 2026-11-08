import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { sendEmail } from "@/server/email/port";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { issuePasswordToken } from "@/server/auth/password-tokens";
import { requestResetAction } from "@/app/forgot-password/actions";
import { setPasswordAction } from "@/app/set-password/[token]/actions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

// `after()` runs its callback once the response is sent. Here it runs it at once and keeps
// the promise so the test can wait for it.
const pendingAfter: Promise<unknown>[] = [];
vi.mock("next/server", () => ({
  after: vi.fn((task: () => Promise<unknown>) => {
    pendingAfter.push(task());
  }),
}));

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

const SENT = { sent: true };

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function createAdmin() {
  return createUser({
    email: "admin@example.com",
    name: "Admin",
    role: "ADMIN",
    passwordHash: await hashPassword("oldpass12"),
  });
}

describe("requestResetAction (forgot password)", () => {
  beforeEach(async () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.mocked(sendEmail).mockReset();
    pendingAfter.length = 0;
    await resetTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("known email → same answer, one reset email sent after the response", async () => {
    await createAdmin();
    expect(await requestResetAction(null, form({ email: "admin@example.com" }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("unknown email → same answer, no email", async () => {
    expect(await requestResetAction(null, form({ email: "nobody@example.com" }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("missing or oversized email → same answer, nothing looked up", async () => {
    await createAdmin();
    expect(await requestResetAction(null, form({}))).toEqual(SENT);
    expect(await requestResetAction(null, form({ email: `${"a".repeat(250)}@example.com` }))).toEqual(SENT);
    await Promise.all(pendingAfter);
    expect(pendingAfter).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("setPasswordAction", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("valid token and matching valid passwords → password set, redirect to /login?reset=1", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "RESET");
    await expect(
      setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    const row = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(await verifyPassword(row.passwordHash!, "newpass34")).toBe(true);
  });

  it("used or unknown token → expired state", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "RESET");
    const fd = () => form({ token, password: "newpass34", confirm: "newpass34" });
    await expect(setPasswordAction(null, fd())).rejects.toThrow("NEXT_REDIRECT");
    expect(await setPasswordAction(null, fd())).toEqual({ status: "expired" });
    expect(
      await setPasswordAction(null, form({ token: "nope", password: "newpass34", confirm: "newpass34" })),
    ).toEqual({ status: "expired" });
  });

  it("password breaking the rule → rule copy, token still usable", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(await setPasswordAction(null, form({ token, password: "short", confirm: "short" }))).toEqual({
      error: "At least 8 characters, with letters and numbers.",
    });
    await expect(
      setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass34" })),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
  });

  it("passwords that do not match → error, token still usable", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(
      await setPasswordAction(null, form({ token, password: "newpass34", confirm: "newpass35" })),
    ).toEqual({ error: "The passwords do not match." });
    expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("missing fields → rejected without touching the token", async () => {
    const admin = await createAdmin();
    const token = await issuePasswordToken(admin.id, "SET");
    expect(await setPasswordAction(null, form({ token, password: "newpass34" }))).toEqual({
      status: "expired",
    });
    expect(await setPasswordAction(null, form({ password: "newpass34", confirm: "newpass34" }))).toEqual({
      status: "expired",
    });
    expect((await db.passwordToken.findFirstOrThrow()).usedAt).toBeNull();
  });

  it("a userId sent with the form is ignored: the token alone decides whose password changes", async () => {
    const admin = await createAdmin();
    const other = await createUser({ email: "other@example.com", name: "O", role: "ADMIN" });
    const token = await issuePasswordToken(admin.id, "SET");
    await expect(
      setPasswordAction(
        null,
        form({ token, password: "newpass34", confirm: "newpass34", userId: other.id }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/login?reset=1");
    const otherRow = await db.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(otherRow.passwordHash).toBeNull();
  });
});

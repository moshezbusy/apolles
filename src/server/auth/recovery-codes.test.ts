import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { createSession, getSession } from "@/server/auth/session";
import { RECOVERY_CODE_COUNT, RecoveryCodesNotAllowed, checkRecoveryCodeForSession, countUnusedRecoveryCodes, createRecoveryCodes, normalizeRecoveryCode } from "./recovery-codes";

vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

async function admin({ confirmed = true } = {}) {
  const user = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  if (confirmed) await db.user.update({ where: { id: user.id }, data: { totpSecret: "x", totpConfirmedAt: new Date() } });
  const session = await getSession(await createSession(user.id, { verified: true }));
  return { user, sessionId: session!.sessionId };
}

const verified = async (sessionId: string) => (await db.session.findUniqueOrThrow({ where: { id: sessionId } })).totpVerifiedAt !== null;

describe("admin recovery codes", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(notifyAdminLockout).mockClear();
  });

  it("10 codes, shown once: only hashes are stored, and the audit row holds counts only", async () => {
    const { user } = await admin();
    const codes = await createRecoveryCodes(user.id);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
    const stored = JSON.stringify(await db.totpRecoveryCode.findMany());
    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normalizeRecoveryCode(code)!);
    }
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "admin.recovery-codes.create" } });
    expect(row).toMatchObject({ before: { codes: 0 }, after: { codes: 10 } });
    expect(JSON.stringify(row)).not.toContain(codes[0]!);
  });

  it("only for an admin whose authenticator is set up", async () => {
    const { user } = await admin({ confirmed: false });
    await expect(createRecoveryCodes(user.id)).rejects.toThrow(RecoveryCodesNotAllowed);
    const agent = await createUser({ email: "agent@example.com", name: "Agent", role: "AGENT" });
    await expect(createRecoveryCodes(agent.id)).rejects.toThrow(RecoveryCodesNotAllowed);
  });

  it("a code signs in once (typed in any case, with or without dashes), and is then used up", async () => {
    const { user, sessionId } = await admin();
    const [code] = await createRecoveryCodes(user.id);
    expect(await checkRecoveryCodeForSession(sessionId, ` ${code!.toLowerCase().replace(/-/g, " ")} `)).toBe("OK");
    expect(await verified(sessionId)).toBe(true);
    expect(await countUnusedRecoveryCodes(user.id)).toBe(9);
    expect(await db.auditLog.count({ where: { action: "user.sign-in", after: { equals: { secondStep: "recovery-code" } } } })).toBe(1);

    const other = await getSession(await createSession(user.id, { verified: true }));
    expect(await checkRecoveryCodeForSession(other!.sessionId, code!)).toBe("WRONG");
    expect(await verified(other!.sessionId)).toBe(false);
  });

  it("making a new set makes every old code stop working", async () => {
    const { user, sessionId } = await admin();
    const old = await createRecoveryCodes(user.id);
    const fresh = await createRecoveryCodes(user.id);
    expect(await countUnusedRecoveryCodes(user.id)).toBe(10);
    expect(await checkRecoveryCodeForSession(sessionId, old[0]!)).toBe("WRONG");
    expect(await checkRecoveryCodeForSession(sessionId, fresh[0]!)).toBe("OK");
  });

  it("wrong codes count like wrong authenticator codes: the third locks the second step and ends every session", async () => {
    const { user, sessionId } = await admin();
    const [code] = await createRecoveryCodes(user.id);
    const wrong = "AAAA-AAAA-AAAA-AAAA";
    expect(await checkRecoveryCodeForSession(sessionId, wrong)).toBe("WRONG");
    expect(await checkRecoveryCodeForSession(sessionId, wrong)).toBe("WRONG");
    expect(await checkRecoveryCodeForSession(sessionId, wrong)).toBe("LOCKED");
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(notifyAdminLockout).toHaveBeenCalledTimes(1);
    // Locked: even a right code is not checked, and stays unused.
    const next = await getSession(await createSession(user.id, { verified: true }));
    expect(await checkRecoveryCodeForSession(next!.sessionId, code!)).toBe("LOCKED");
    expect(await countUnusedRecoveryCodes(user.id)).toBe(10);
  });

  it("text that cannot be a recovery code is refused without counting", async () => {
    const { user, sessionId } = await admin();
    for (const input of ["", "123456", "ABCD-EFGH", "OOOO-IIII-LLLL-0000"]) expect(await checkRecoveryCodeForSession(sessionId, input)).toBe("WRONG");
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).failedLogins).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/server/email/port";
import { notifyAdminLockout } from "@/server/auth/notifications";
import { MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

describe("notifyAdminLockout", () => {
  afterEach(() => {
    vi.mocked(sendEmail).mockClear();
    vi.unstubAllEnvs();
  });

  it("emails ADMIN_ALERT_EMAIL naming the account and the unlock time", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAIL", "alerts@test.local");
    const lockedUntil = new Date("2026-11-08T10:15:00.000Z");
    await notifyAdminLockout({ id: "u1", email: "agent@example.com", lockedUntil });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(msg.to).toBe("alerts@test.local");
    expect(msg.subject).toContain("agent@example.com");
    expect(msg.text).toContain("agent@example.com");
    expect(msg.text).toContain("2026-11-08 10:15 UTC");
    expect(msg.text).toContain(`had ${MAX_FAILED_LOGINS} wrong sign-in codes in a row`);
  });

  it("wrong passwords: says guessing is paused and the owner can still sign in elsewhere", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAIL", "alerts@test.local");
    await notifyAdminLockout({ id: "u1", email: "agent@example.com", lockedUntil: new Date("2026-11-08T10:15:00.000Z"), step: "password" });
    const msg = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(msg.subject).toBe("Apolles: sign-in paused (agent@example.com)");
    expect(msg.text).toContain("paused until 2026-11-08 10:15 UTC");
    expect(msg.text).toContain("can still sign in");
  });

  it("refuses to send when ADMIN_ALERT_EMAIL is missing or not an email", async () => {
    vi.stubEnv("ADMIN_ALERT_EMAIL", "");
    const user = { id: "u1", email: "agent@example.com", lockedUntil: new Date() };
    await expect(notifyAdminLockout(user)).rejects.toThrow(/ADMIN_ALERT_EMAIL/);
    vi.stubEnv("ADMIN_ALERT_EMAIL", "not-an-email");
    await expect(notifyAdminLockout(user)).rejects.toThrow(/ADMIN_ALERT_EMAIL/);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

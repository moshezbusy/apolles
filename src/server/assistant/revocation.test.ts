import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { setAgencyStatus } from "@/server/admin/agencies";
import { hashPassword } from "@/server/auth/password";
import { consumePasswordToken, issuePasswordToken } from "@/server/auth/password-tokens";
import { recordFailedAttempt } from "@/server/auth/lockout";
import { MAX_FAILED_LOGINS } from "@/server/auth/lockout-policy";
import { createConnection, verifyAccessToken } from "./connections";

// Owner decision (2026-11-22): an assistant's access ends on agency suspension, password change,
// lockout and manual Revoke (manual Revoke: oauth.test.ts). The same places that end sessions.

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));
vi.mock("@/server/auth/notifications", () => ({ notifyAdminLockout: vi.fn() }));

const RESOURCE = "https://mcp.apolles.test/mcp";
const saved = process.env.MCP_PUBLIC_URL;

async function connectedAgent() {
  const agency = await db.agency.create({ data: { name: "Agency", country: "IL", bankReference: "APL-0001" } });
  const user = await createUser({ email: "agent@example.com", name: "Agent", role: "AGENT", agencyId: agency.id, passwordHash: await hashPassword("oldpass12") });
  const client = await db.assistantClient.create({ data: { id: "apc_test", name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] } });
  const { accessToken } = await db.$transaction((tx) =>
    createConnection(tx, { userId: user.id, agencyId: agency.id, clientId: client.id, clientName: "Claude", resource: RESOURCE }, new Date()),
  );
  // A sign-in the agent approved that the assistant has not finished yet goes too.
  await db.assistantAuthRequest.create({
    data: { id: "r".repeat(32), clientId: client.id, redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: "c".repeat(43), resource: RESOURCE, userId: user.id, agencyId: agency.id, expiresAt: new Date(Date.now() + 60_000) },
  });
  expect(await verifyAccessToken(accessToken)).not.toBeNull();
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  return { user, agency, accessToken, adminId: admin.id };
}

async function revokedReason(): Promise<string | null> {
  return (await db.assistantConnection.findFirstOrThrow()).revokedReason;
}

describe("assistant access ends where sessions end", () => {
  beforeEach(async () => {
    await resetTestDb();
    process.env.MCP_PUBLIC_URL = RESOURCE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_PUBLIC_URL;
    else process.env.MCP_PUBLIC_URL = saved;
  });

  it("agency suspension revokes every assistant of the agency, for good (reactivation does not bring it back)", async () => {
    const { agency, accessToken, adminId } = await connectedAgent();
    await setAgencyStatus(adminId, agency.id, "SUSPENDED");
    expect(await revokedReason()).toBe("agency_suspended");
    expect(await db.assistantAuthRequest.count()).toBe(0);
    await setAgencyStatus(adminId, agency.id, "ACTIVE");
    expect(await verifyAccessToken(accessToken)).toBeNull();
    expect(await db.auditLog.count({ where: { action: "assistant.revoke", actorUserId: adminId } })).toBe(1);
  });

  it("a password change revokes every assistant of the agent", async () => {
    const { user, accessToken } = await connectedAgent();
    const link = await issuePasswordToken(user.id, "RESET");
    expect(await consumePasswordToken(link, "newpass34")).toBe("OK");
    expect(await verifyAccessToken(accessToken)).toBeNull();
    expect(await revokedReason()).toBe("password_changed");
    expect(await db.assistantAuthRequest.count()).toBe(0);
  });

  it("a lockout revokes every assistant of the agent", async () => {
    const { user, accessToken } = await connectedAgent();
    await db.user.update({ where: { id: user.id }, data: { failedLogins: MAX_FAILED_LOGINS } });
    expect(await recordFailedAttempt({ id: user.id, email: user.email }, MAX_FAILED_LOGINS)).toBe("LOCKED");
    expect(await revokedReason()).toBe("locked_out");
    // Still revoked when the 15-minute lock is over.
    await db.user.update({ where: { id: user.id }, data: { lockedUntil: null } });
    expect(await verifyAccessToken(accessToken)).toBeNull();
  });

  it("a wrong code that does not lock leaves the assistant connected", async () => {
    const { user, accessToken } = await connectedAgent();
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 1 } });
    expect(await recordFailedAttempt({ id: user.id, email: user.email }, 1)).toBe("COUNTED");
    expect(await verifyAccessToken(accessToken)).not.toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { sendEmail } from "@/server/email/port";
import { createSession, getSession } from "@/server/auth/session";
import { credit, getBalance, getBalances, placeHold, releaseHold } from "@/server/wallet/ledger";
import { audit } from "@/server/audit";
import { createAgency, listAgencies, setAgencyStatus } from "@/server/admin/agencies";

vi.mock("@/server/email/port", () => ({ sendEmail: vi.fn() }));

const input = {
  name: "Sunrise Travel",
  country: "IL",
  agentName: "Dana Agent",
  agentEmail: "Dana@Example.com",
};

let adminId: string;

describe("admin agencies", () => {
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    adminId = (await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" })).id;
  });

  describe("createAgency", () => {
    it("creates agency + AGENT user + SET email + audit row", async () => {
      const result = await createAgency(adminId, input);
      expect(result.emailSent).toBe(true);

      const agency = await db.agency.findUniqueOrThrow({ where: { id: result.agencyId } });
      expect(agency).toMatchObject({ name: "Sunrise Travel", country: "IL", status: "ACTIVE" });
      expect(agency.bankReference).toBe("APL-0001");

      const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
      expect(user).toMatchObject({
        email: "dana@example.com",
        name: "Dana Agent",
        role: "AGENT",
        agencyId: agency.id,
        passwordHash: null,
      });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const msg = vi.mocked(sendEmail).mock.calls[0]![0];
      expect(msg.to).toBe("dana@example.com");
      expect(msg.subject).toBe("Set your Apolles password");
      expect(msg.text).toContain("/set-password/");
      expect(await db.passwordToken.count({ where: { userId: user.id, purpose: "SET" } })).toBe(1);

      const rows = await db.auditLog.findMany({ where: { action: "agency.create" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: adminId,
        targetType: "Agency",
        targetId: agency.id,
        before: null,
      });
      // Exact field set: proves the row holds no password hash, TOTP secret or token.
      expect(rows[0]!.after).toEqual({
        name: "Sunrise Travel",
        country: "IL",
        bankReference: "APL-0001",
        status: "ACTIVE",
        agentUserId: user.id,
      });
    });

    it("duplicate agentEmail → 'A user with this email already exists', nothing created", async () => {
      await createUser({ email: "dana@example.com", name: "Old", role: "ADMIN" });
      await expect(createAgency(adminId, input)).rejects.toThrow(
        "A user with this email already exists",
      );
      expect(await db.agency.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("bank references look like APL-0001 and are unique across agencies", async () => {
      const a = await createAgency(adminId, input);
      const b = await createAgency(adminId, { ...input, agentEmail: "other@example.com" });
      const rows = await db.agency.findMany({ orderBy: { bankRefNo: "asc" } });
      expect(rows.map((r) => r.bankReference)).toEqual(["APL-0001", "APL-0002"]);
      expect(a.agencyId).not.toBe(b.agencyId);
      for (const r of rows) {
        expect(r.bankReference).toBe(`APL-${String(r.bankRefNo).padStart(4, "0")}`);
      }
    });

    it("email failure: agency stays created and the result says the email was not sent", async () => {
      vi.mocked(sendEmail).mockRejectedValue(new Error("smtp down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await createAgency(adminId, input);
      expect(result.emailSent).toBe(false);
      expect(await db.agency.count()).toBe(1);
      expect(await db.user.count({ where: { role: "AGENT" } })).toBe(1);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("dana@example.com");
      errorSpy.mockRestore();
    });

    it("rejects invalid input at the service too", async () => {
      await expect(createAgency(adminId, { ...input, country: "israel" })).rejects.toThrow();
      expect(await db.agency.count()).toBe(0);
    });
  });

  describe("setAgencyStatus", () => {
    it("suspend → agent session is gone + audit row with before/after status", async () => {
      const { agencyId, userId } = await createAgency(adminId, input);
      await db.user.update({ where: { id: userId }, data: { passwordHash: "x" } });
      const token = await createSession(userId);
      expect(await getSession(token)).not.toBeNull();

      const res = await setAgencyStatus(adminId, agencyId, "SUSPENDED");
      expect(res.changed).toBe(true);
      expect(await getSession(token)).toBeNull();
      expect(await db.session.count({ where: { userId } })).toBe(0);
      expect((await db.agency.findUniqueOrThrow({ where: { id: agencyId } })).status).toBe(
        "SUSPENDED",
      );

      const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.suspend" } });
      expect(row).toMatchObject({
        actorUserId: adminId,
        targetType: "Agency",
        targetId: agencyId,
        before: { status: "ACTIVE" },
        after: { status: "SUSPENDED" },
      });
    });

    it("reactivate → ACTIVE + audit row agency.reactivate", async () => {
      const { agencyId } = await createAgency(adminId, input);
      await setAgencyStatus(adminId, agencyId, "SUSPENDED");
      await setAgencyStatus(adminId, agencyId, "ACTIVE");
      const row = await db.auditLog.findFirstOrThrow({ where: { action: "agency.reactivate" } });
      expect(row).toMatchObject({ before: { status: "SUSPENDED" }, after: { status: "ACTIVE" } });
    });

    it("same status again → no write, no audit row", async () => {
      const { agencyId } = await createAgency(adminId, input);
      const before = await db.auditLog.count();
      const res = await setAgencyStatus(adminId, agencyId, "ACTIVE");
      expect(res.changed).toBe(false);
      expect(await db.auditLog.count()).toBe(before);
    });

    it("unknown agency → error", async () => {
      await expect(setAgencyStatus(adminId, "nope", "SUSPENDED")).rejects.toThrow("Agency not found");
    });
  });

  describe("audit", () => {
    it("writes inside the given transaction (rolls back with it)", async () => {
      await expect(
        db.$transaction(async (tx) => {
          await audit(adminId, "x.test", "Thing", "1", undefined, { a: 1 }, tx);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await db.auditLog.count()).toBe(0);
    });
  });

  describe("listAgencies", () => {
    it("paginates: each agency exactly once, with agent email and balances", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await createAgency(adminId, { ...input, name: `Agency ${i}`, agentEmail: `a${i}@example.com` });
        ids.push(r.agencyId);
      }
      await credit({
        agencyId: ids[0]!,
        type: "TOPUP_BANK",
        amountCents: 5000,
        reason: "t",
        idempotencyKey: "k1",
      });
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await listAgencies(cursor, 2);
        pages++;
        expect(page.agencies.length).toBeLessThanOrEqual(2);
        seen.push(...page.agencies.map((a) => a.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(pages).toBe(3);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);

      const all = await listAgencies(undefined, 100);
      const first = all.agencies.find((a) => a.id === ids[0])!;
      expect(first).toMatchObject({ balanceCents: 5000, heldCents: 0, agentEmail: "a0@example.com" });
      expect(all.nextCursor).toBeNull();
    });

    it("clamps take to 1..100 and rejects an unknown cursor", async () => {
      await createAgency(adminId, input);
      expect((await listAgencies(undefined, 0)).agencies).toHaveLength(1);
      await expect(listAgencies("nope")).rejects.toThrow("Invalid cursor");
    });
  });

  describe("getBalances", () => {
    it("equals getBalance per agency, including open and closed holds", async () => {
      const a = (await createAgency(adminId, input)).agencyId;
      const b = (await createAgency(adminId, { ...input, agentEmail: "b@example.com" })).agencyId;
      const c = (await createAgency(adminId, { ...input, agentEmail: "c@example.com" })).agencyId;
      await credit({ agencyId: a, type: "TOPUP_BANK", amountCents: 10000, reason: "t", idempotencyKey: "a1" });
      await credit({ agencyId: b, type: "TOPUP_BANK", amountCents: 7000, reason: "t", idempotencyKey: "b1" });
      await placeHold({ agencyId: a, amountCents: 3000, bookingRef: "B1", idempotencyKey: "h1" }); // open
      const closed = await placeHold({ agencyId: b, amountCents: 2000, bookingRef: "B2", idempotencyKey: "h2" });
      await releaseHold(closed.holdId, "r1"); // closed
      await placeHold({ agencyId: b, amountCents: 1000, bookingRef: "B3", idempotencyKey: "h3" }); // open

      const map = await getBalances([a, b, c]);
      for (const id of [a, b, c]) {
        expect(map.get(id)).toEqual(await getBalance(id));
      }
      expect(map.get(a)).toEqual({ balanceCents: 7000, heldCents: 3000 });
      expect(map.get(c)).toEqual({ balanceCents: 0, heldCents: 0 });
      expect((await getBalances([])).size).toBe(0);
    });
  });
});

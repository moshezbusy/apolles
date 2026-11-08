import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import { SESSION_COOKIE, createSession } from "@/server/auth/session";
import { credit } from "@/server/wallet/ledger";
import {
  confirmTopupAction,
  recordAdjustmentAction,
  recordPayoutAction,
} from "@/app/admin/agencies/[id]/wallet/actions";

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let agencyId: string;

async function signInAdmin() {
  const admin = await createUser({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  await db.user.update({
    where: { id: admin.id },
    data: { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", totpConfirmedAt: new Date() },
  });
  const token = await createSession(admin.id);
  await db.session.updateMany({ where: { userId: admin.id }, data: { totpVerifiedAt: new Date() } });
  jar.set(SESSION_COOKIE, token);
  return admin;
}

const topupForm = (overrides: Record<string, string> = {}) =>
  form({ agencyId, amount: "1,000.00", bankTransferRef: "TRX-1", receivedOn: "2026-11-01", ...overrides });
const payoutForm = (overrides: Record<string, string> = {}) =>
  form({ agencyId, amount: "25", note: "Payout to agency", idempotencyKey: randomUUID(), ...overrides });
const adjustForm = (overrides: Record<string, string> = {}) =>
  form({ agencyId, amount: "-12.50", reason: "Bank fee correction", idempotencyKey: randomUUID(), ...overrides });

describe("wallet server actions", () => {
  beforeEach(async () => {
    await resetTestDb();
    jar.clear();
    agencyId = (await db.agency.create({ data: { name: "Sunrise", country: "IL", bankReference: "APL-0001" } })).id;
  });

  it("rejects callers without an admin session (redirect), nothing written", async () => {
    await expect(confirmTopupAction(null, topupForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(recordPayoutAction(null, payoutForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(recordAdjustmentAction(null, adjustForm())).rejects.toThrow("NEXT_REDIRECT:/login");

    const agent = await createUser({ email: "ag@example.com", name: "Ag", role: "AGENT", agencyId });
    jar.set(SESSION_COOKIE, await createSession(agent.id));
    await expect(confirmTopupAction(null, topupForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(recordPayoutAction(null, payoutForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(recordAdjustmentAction(null, adjustForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("an admin whose TOTP code is not entered is sent to /admin/2fa", async () => {
    const admin = await createUser({ email: "a2@example.com", name: "A", role: "ADMIN" });
    await db.user.update({
      where: { id: admin.id },
      data: { totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", totpConfirmedAt: new Date() },
    });
    jar.set(SESSION_COOKIE, await createSession(admin.id));
    await expect(confirmTopupAction(null, topupForm())).rejects.toThrow("NEXT_REDIRECT:/admin/2fa");
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("top-up: success, then 'already recorded', with the admin as actor", async () => {
    const admin = await signInAdmin();
    expect(await confirmTopupAction(null, topupForm())).toEqual({
      status: "success",
      message: "Top-up of USD 1,000.00 recorded.",
    });
    expect(await confirmTopupAction(null, topupForm({ bankTransferRef: " trx-1 " }))).toEqual({
      status: "info",
      message: "This bank transfer was already recorded. Nothing was added.",
    });
    expect(await db.ledgerEntry.count()).toBe(1);
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "wallet.topup" } });
    expect(row.actorUserId).toBe(admin.id);
  });

  it("top-up: same ref with a different amount → the TopupRefConflict message", async () => {
    await signInAdmin();
    await confirmTopupAction(null, topupForm());
    expect(await confirmTopupAction(null, topupForm({ amount: "999" }))).toEqual({
      status: "error",
      message: "This bank transfer reference was already recorded for USD 1,000.00.",
    });
    expect(await db.ledgerEntry.count()).toBe(1);
  });

  it("top-up: bad amount text, future date or missing ref → validation message, nothing written", async () => {
    await signInAdmin();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    for (const overrides of [
      { amount: "1.234" },
      { amount: "-5" },
      { amount: "0" },
      { amount: "abc" },
      { receivedOn: future },
      { receivedOn: "2019-05-05" },
      { bankTransferRef: "  " },
    ]) {
      const state = await confirmTopupAction(null, topupForm(overrides));
      expect(state?.status, JSON.stringify(overrides)).toBe("error");
    }
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("top-up: the agency reference (APL-…) as bank transfer reference → its own message, nothing written", async () => {
    await signInAdmin();
    for (const bankTransferRef of ["APL-0001", " apl-0001 "]) {
      expect(await confirmTopupAction(null, topupForm({ bankTransferRef }))).toEqual({
        status: "error",
        message: "Enter the bank's own transfer reference, not the agency reference (APL-…).",
      });
    }
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(await confirmTopupAction(null, topupForm({ bankTransferRef: "BT-778812" }))).toEqual({
      status: "success",
      message: "Top-up of USD 1,000.00 recorded.",
    });
  });

  it("payout: InsufficientFunds → 'Not enough available balance.'", async () => {
    await signInAdmin();
    expect(await recordPayoutAction(null, payoutForm())).toEqual({
      status: "error",
      message: "Not enough available balance.",
    });
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("payout: success, and a resubmitted form (same key) is 'already recorded'", async () => {
    await signInAdmin();
    await credit({ agencyId, type: "TOPUP_BANK", amountCents: 10000, reason: "seed", idempotencyKey: "seed" });
    const fields = { idempotencyKey: randomUUID() };
    expect(await recordPayoutAction(null, payoutForm(fields))).toEqual({
      status: "success",
      message: "Payout of USD 25.00 recorded.",
    });
    expect(await recordPayoutAction(null, payoutForm(fields))).toEqual({
      status: "info",
      message: "This payout was already recorded. Nothing was changed.",
    });
    expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(1);
  });

  it("payout: a key that is not a UUID or an empty note → validation message", async () => {
    await signInAdmin();
    await credit({ agencyId, type: "TOPUP_BANK", amountCents: 10000, reason: "seed", idempotencyKey: "seed" });
    for (const overrides of [{ idempotencyKey: "abc" }, { note: "" }, { amount: "" }]) {
      const state = await recordPayoutAction(null, payoutForm(overrides));
      expect(state?.status, JSON.stringify(overrides)).toBe("error");
    }
    expect(await db.ledgerEntry.count({ where: { type: "PAYOUT" } })).toBe(0);
  });

  it("adjustment: negative and positive amounts, short reason rejected", async () => {
    await signInAdmin();
    await credit({ agencyId, type: "TOPUP_BANK", amountCents: 10000, reason: "seed", idempotencyKey: "seed" });
    expect(await recordAdjustmentAction(null, adjustForm())).toEqual({
      status: "success",
      message: "Adjustment of -USD 12.50 recorded.",
    });
    expect(await recordAdjustmentAction(null, adjustForm({ amount: "5" }))).toEqual({
      status: "success",
      message: "Adjustment of USD 5.00 recorded.",
    });
    expect((await recordAdjustmentAction(null, adjustForm({ reason: "abcd" })))?.status).toBe("error");
    expect((await recordAdjustmentAction(null, adjustForm({ amount: "0" })))?.status).toBe("error");
    expect(await recordAdjustmentAction(null, adjustForm({ amount: "-1,000" }))).toEqual({
      status: "error",
      message: "Not enough available balance.",
    });
    expect(await db.ledgerEntry.count({ where: { type: "ADJUSTMENT" } })).toBe(2);
  });

  it("an unknown agency → 'Agency not found.'", async () => {
    await signInAdmin();
    expect(await confirmTopupAction(null, topupForm({ agencyId: "no-such-agency" }))).toEqual({
      status: "error",
      message: "Agency not found.",
    });
  });
});

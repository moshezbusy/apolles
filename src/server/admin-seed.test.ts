import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser } from "@/server/users";
import { resetTestDb } from "@/test/db";
import * as email from "@/server/email/port";
import { seedAdmin } from "@/server/admin-seed";

describe("seedAdmin", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the first admin without a password and emails one SET link", async () => {
    const send = vi.spyOn(email, "sendEmail").mockResolvedValue();

    expect(await seedAdmin(" Owner@Example.COM ")).toBe("CREATED");

    const users = await db.user.findMany();
    expect(users).toHaveLength(1);
    const admin = users[0]!;
    expect(admin).toMatchObject({
      email: "owner@example.com",
      name: "Admin",
      role: "ADMIN",
      agencyId: null,
      passwordHash: null,
      totpSecret: null,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      to: "owner@example.com",
      subject: "Set your Apolles password",
    });
    const tokens = await db.passwordToken.findMany({ where: { userId: admin.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("SET");
  });

  it("second run → EXISTS, creates nothing and sends nothing", async () => {
    const send = vi.spyOn(email, "sendEmail").mockResolvedValue();
    await seedAdmin("owner@example.com");
    send.mockClear();

    expect(await seedAdmin("OWNER@example.com")).toBe("EXISTS");
    expect(await db.user.count()).toBe(1);
    expect(await db.passwordToken.count()).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("an existing user with that email (even an agent) → EXISTS, nothing changed", async () => {
    const send = vi.spyOn(email, "sendEmail").mockResolvedValue();
    const agency = await db.agency.create({
      data: { name: "Agency", country: "IL", bankReference: "APL-0001" },
    });
    await createUser({ email: "owner@example.com", name: "A", role: "AGENT", agencyId: agency.id });

    expect(await seedAdmin("owner@example.com")).toBe("EXISTS");
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before touching the database", async () => {
    const send = vi.spyOn(email, "sendEmail").mockResolvedValue();
    await expect(seedAdmin("not-an-email")).rejects.toThrow("SEED_ADMIN_EMAIL");
    await expect(seedAdmin("")).rejects.toThrow("SEED_ADMIN_EMAIL");
    expect(await db.user.count()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("prints nothing secret: the set-password link never reaches the console", async () => {
    const printed: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
      });
    }
    // The real console email adapter runs (no EMAIL_SINK_FILE in tests).
    expect(await seedAdmin("owner@example.com")).toBe("CREATED");
    const output = printed.join("\n");
    expect(output).not.toContain("/set-password/");
    expect(output).not.toMatch(/[A-Za-z0-9_-]{43}/); // no raw 32-byte token
  });
});

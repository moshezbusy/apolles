import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createUser, normalizeEmail } from "@/server/users";
import { resetTestDb } from "@/test/db";

describe("user email uniqueness", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("normalizes email by trimming and lowercasing", () => {
    expect(normalizeEmail("  Agent@Example.COM ")).toBe("agent@example.com");
  });

  it("rejects a second user whose email differs only by case", async () => {
    await createUser({ email: "Agent@Example.com", name: "First", role: "AGENT" });
    await expect(
      createUser({ email: "agent@example.com", name: "Second", role: "AGENT" }),
    ).rejects.toThrow();

    const users = await db.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("agent@example.com");
  });
});

describe("db client creation", () => {
  it("importing db without DATABASE_URL does not throw; the first query does", async () => {
    const cache = globalThis as unknown as { __apollesDb?: unknown };
    const saved = cache.__apollesDb;
    delete cache.__apollesDb;
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();
    try {
      const fresh = await import("@/server/db");
      expect(() => fresh.db.user).toThrow("DATABASE_URL is not set");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      cache.__apollesDb = saved;
    }
  });
});

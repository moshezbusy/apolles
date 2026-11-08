import { beforeEach, describe, expect, it } from "vitest";
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

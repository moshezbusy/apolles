import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { td } from "@/components/ui";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/admin/agencies", () => ({
  listAgencies: vi.fn(async () => ({
    agencies: [
      {
        id: "ag1",
        name: "Caryotrip",
        country: "IL",
        bankReference: "APL-0001",
        status: "ACTIVE",
        agentEmail: "agent@test.local",
        agentInvited: false,
        balanceCents: 0,
      },
      {
        id: "ag2",
        name: "New Travel",
        country: "IL",
        bankReference: "APL-0002",
        status: "ACTIVE",
        agentEmail: "new@test.local",
        agentInvited: true,
        balanceCents: 0,
      },
    ],
    nextCursor: null,
  })),
}));

describe("/admin/agencies table", () => {
  // On staging the Country, Bank reference and Balance cells had no text colour of their own,
  // so they inherited a light colour and were almost invisible. Every body cell now sets one.
  it("gives every body cell the dark table-cell style", async () => {
    const { default: Page } = await import("./admin/agencies/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    const cells = [...html.matchAll(/<td[^>]*class="([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(cells.length).toBe(12);
    for (const cls of cells) expect(cls).toContain(td);
    expect(html).toContain("APL-0001");
    expect(html).toContain("USD 0.00");
  });

  it("marks an agency whose agent has not set a password yet, and only that one", async () => {
    const { default: Page } = await import("./admin/agencies/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html.split("Invited, not signed in yet").length - 1).toBe(1);
    expect(html.indexOf("Invited, not signed in yet")).toBeGreaterThan(html.indexOf("New Travel"));
  });
});

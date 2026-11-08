import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgent } from "@/server/auth/guards";
import { db } from "@/server/db";
import { credit, placeHold } from "@/server/wallet/ledger";
import { resetTestDb } from "@/test/db";
import { Header } from "@/components/Header";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/server/auth/guards", () => ({ requireAgent: vi.fn() }));

const BANK_ENV = {
  BANK_DETAILS_BENEFICIARY: "Apolles Test Ltd",
  BANK_DETAILS_BANK_NAME: "Test Bank",
  BANK_DETAILS_ACCOUNT_NUMBER: "000111222",
  BANK_DETAILS_IBAN: "IL000000000000000000000",
  BANK_DETAILS_SWIFT: "TESTILIT",
} as const;

const NOTE = "Top-ups are credited after Apolles confirms the transfer. USD only.";

async function createAgency(name: string, bankReference: string): Promise<string> {
  return (await db.agency.create({ data: { name, country: "IL", bankReference } })).id;
}

function signInAs(agencyId: string): void {
  vi.mocked(requireAgent).mockResolvedValue({ userId: "user-1", agencyId });
}

async function renderBalance(cursor?: string): Promise<string> {
  const { default: BalancePage } = await import("./(agent)/balance/page");
  return renderToStaticMarkup(
    await BalancePage({ searchParams: Promise.resolve(cursor === undefined ? {} : { cursor }) }),
  );
}

async function renderLayout(): Promise<string> {
  const { default: AgentLayout } = await import("./(agent)/layout");
  return renderToStaticMarkup(await AgentLayout({ children: <p>page body</p> }));
}

// The visible text of the element with this id (tags stripped).
function textOf(html: string, id: string): string {
  const match = new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html);
  return (match?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Table body rows as "|cell|cell|...|" (header row left out).
function rowsOf(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|"))
    .slice(1);
}

describe("Header", () => {
  const html = renderToStaticMarkup(<Header agencyName="Test Travel" balanceCents={100000} />);

  it("shows the Apolles wordmark", () => {
    expect(html).toContain("Apolles");
  });

  it("shows Search, Quotes and Reporting disabled with 'Coming soon', not as links", () => {
    for (const item of ["Search", "Quotes", "Reporting"]) {
      expect(html).toMatch(new RegExp(`<span[^>]*aria-disabled="true"[^>]*>${item}`));
      expect(html).not.toMatch(new RegExp(`<a[^>]*>${item}`));
    }
    expect(html.match(/>Coming soon</g)?.length).toBe(3);
  });

  it("has no Bookings item", () => {
    expect(html).not.toContain("Bookings");
  });

  it("shows the balance as a link to /balance", () => {
    expect(html).toMatch(/<a[^>]*href="\/balance"[^>]*>[^<]*USD 1,000.00/);
  });

  it("has an agency menu with Balance & top-ups and a Sign out POST form to /logout", () => {
    expect(html).toContain("Test Travel");
    expect(html).toMatch(/<a[^>]*href="\/balance"[^>]*>Balance &amp; top-ups<\/a>/);
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/logout"|<form[^>]*action="\/logout"[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sign out<\/button>/);
  });
});

describe("agent pages", () => {
  let agencyId: string;

  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(requireAgent).mockReset();
    agencyId = await createAgency("Test Travel", "APL-1042");
    signInAs(agencyId);
    Object.assign(process.env, BANK_ENV);
  });

  afterEach(() => {
    for (const name of Object.keys(BANK_ENV)) delete process.env[name];
  });

  describe("(agent) layout", () => {
    it("checks the agent session and shows the header with the agency's name and balance", async () => {
      await credit({ agencyId, type: "TOPUP_BANK", amountCents: 123456, reason: "t", idempotencyKey: "t-1" });
      const html = await renderLayout();
      expect(requireAgent).toHaveBeenCalledTimes(1);
      expect(html).toContain("Test Travel");
      expect(html).toMatch(/<a[^>]*href="\/balance"[^>]*>[^<]*USD 1,234.56/);
      expect(html).toContain("<p>page body</p>");
    });

    it("no agent session → redirect to /login", async () => {
      vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
      await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT:/login");
    });
  });

  describe("/balance", () => {
    it("checks the agent session itself", async () => {
      await renderBalance();
      expect(requireAgent).toHaveBeenCalledTimes(1);
      vi.mocked(requireAgent).mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
      await expect(renderBalance()).rejects.toThrow("NEXT_REDIRECT:/login");
    });

    it("agent with no entries sees USD 0.00 available and held", async () => {
      const html = await renderBalance();
      expect(textOf(html, "available-balance")).toBe("Available balance USD 0.00");
      expect(textOf(html, "held-balance")).toBe("Held for bookings USD 0.00");
      expect(html).toContain("No transactions yet.");
    });

    it("shows balance, held amount and each row with label, signed amount and balance after", async () => {
      await credit({ agencyId, type: "TOPUP_BANK", amountCents: 100000, reason: "t", idempotencyKey: "t-1" });
      await db.ledgerEntry.updateMany({ where: { agencyId }, data: { createdAt: new Date("2026-11-01T10:00:00Z") } });
      await placeHold({ agencyId, amountCents: 30000, bookingRef: "BK-1", idempotencyKey: "h-1" });

      const html = await renderBalance();
      expect(textOf(html, "available-balance")).toBe("Available balance USD 700.00");
      expect(textOf(html, "held-balance")).toBe("Held for bookings USD 300.00");

      const rows = rowsOf(html);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatch(/\|Hold\|-USD 300.00\|USD 700.00\|/);
      expect(rows[1]).toMatch(/\|2026-11-01 10:00 UTC\|Top-up · bank transfer\|\+USD 1,000.00\|USD 1,000.00\|/);
    });

    it("labels every entry type", async () => {
      const { TYPE_LABEL } = await import("./(agent)/balance/labels");
      expect(TYPE_LABEL).toEqual({
        TOPUP_BANK: "Top-up · bank transfer",
        HOLD: "Hold",
        HOLD_RELEASE: "Hold released",
        CHARGE: "Booking charge",
        REFUND: "Refund",
        PAYOUT: "Payout",
        ADJUSTMENT: "Adjustment",
      });
    });

    it("shows only the signed-in agency's entries", async () => {
      const otherId = await createAgency("Other Travel", "APL-2000");
      await credit({ agencyId: otherId, type: "REFUND", amountCents: 777, reason: "o", idempotencyKey: "o-1" });
      const html = await renderBalance();
      expect(html).not.toContain("USD 7.77");
      expect(html).not.toContain("APL-2000");
      expect(html).toContain("No transactions yet.");
    });

    it("shows the bank transfer details, the agency's reference and the note; no card top-up", async () => {
      const html = await renderBalance();
      const section = textOf(html, "bank-transfer");
      for (const [label, value] of [
        ["Beneficiary", BANK_ENV.BANK_DETAILS_BENEFICIARY],
        ["Bank", BANK_ENV.BANK_DETAILS_BANK_NAME],
        ["Account number", BANK_ENV.BANK_DETAILS_ACCOUNT_NUMBER],
        ["IBAN", BANK_ENV.BANK_DETAILS_IBAN],
        ["SWIFT", BANK_ENV.BANK_DETAILS_SWIFT],
      ]) {
        expect(section).toContain(`${label} ${value}`);
      }
      expect(section).toContain("Reference: APL-1042");
      expect(html).toContain(NOTE);
      expect(html).not.toMatch(/card/i);
    });

    it("leaves out bank details that are not configured", async () => {
      delete process.env.BANK_DETAILS_IBAN;
      delete process.env.BANK_DETAILS_SWIFT;
      const section = textOf(await renderBalance(), "bank-transfer");
      expect(section).toContain("Beneficiary Apolles Test Ltd");
      expect(section).not.toContain("IBAN");
      expect(section).not.toContain("SWIFT");
      expect(section).toContain("Reference: APL-1042");
    });

    it("pages the history with Load more, and an invalid cursor goes back to /balance", async () => {
      await db.ledgerEntry.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({
          agencyId,
          type: "TOPUP_BANK" as const,
          amountCents: 100,
          reason: "seed",
          idempotencyKey: `seed-${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
        })),
      });
      const html = await renderBalance();
      const next = /href="\/balance\?cursor=([^"]+)"[^>]*>Load more/.exec(html)?.[1];
      expect(next).toBeDefined();
      const second = await renderBalance(decodeURIComponent(next ?? ""));
      expect(second).not.toContain("Load more");
      expect(rowsOf(html)).toHaveLength(50);
      expect(rowsOf(html)[0]).toMatch(/\|\+USD 1.00\|USD 51.00\|$/);
      // Page 2 holds only the oldest row: its balance after is its own amount.
      expect(rowsOf(second)).toEqual([expect.stringMatching(/^\|2026-01-01 00:00 UTC\|Top-up · bank transfer\|\+USD 1.00\|USD 1.00\|$/)]);

      await expect(renderBalance("not-a-cursor")).rejects.toThrow("NEXT_REDIRECT:/balance");
    });
  });
});

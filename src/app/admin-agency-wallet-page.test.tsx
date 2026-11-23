import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAgencyInvitation } from "@/server/admin/agencies";

// The admin's agency page (wallet): the invitation state of the agency's agent, the warning
// when the set-up email failed on approval, and the "send it again" button.

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/admin/money", () => ({
  getAgencyWallet: vi.fn(async () => ({
    agency: { id: "ag1", name: "New Travel", bankReference: "APL-0002" },
    balance: { balanceCents: 0, heldCents: 0 },
    entries: [],
    nextCursor: null,
  })),
}));
vi.mock("@/server/admin/agencies", () => ({ getAgencyInvitation: vi.fn() }));
vi.mock("./admin/agencies/[id]/wallet/actions", () => ({ confirmTopupAction: vi.fn(), recordPayoutAction: vi.fn(), recordAdjustmentAction: vi.fn() }));
vi.mock("./admin/agencies/actions", () => ({ resendSetupEmailAction: vi.fn() }));

async function render(search: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./admin/agencies/[id]/wallet/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "ag1" }), searchParams: Promise.resolve(search) }));
}

describe("/admin/agencies/[id]/wallet: invitation", () => {
  beforeEach(() => vi.mocked(getAgencyInvitation).mockReset());

  it("agent has not set a password: says so and offers to send the set-up email again", async () => {
    vi.mocked(getAgencyInvitation).mockResolvedValue({ agentEmail: "new@test.local", pending: true });
    const html = await render();
    expect(html).toContain("Invited, not signed in yet");
    expect(html).toContain("new@test.local");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Send the set-up email again<\/button>/);
    expect(html).toContain('name="agencyId" value="ag1"');
    expect(html).not.toContain("could not be sent");
  });

  it("after an approval whose email failed (?email=failed): a clear warning that says what to do", async () => {
    vi.mocked(getAgencyInvitation).mockResolvedValue({ agentEmail: "new@test.local", pending: true });
    const html = await render({ email: "failed" });
    expect(html).toMatch(/role="alert"[^>]*>The agency was opened, but the set-up email to the agent could not be sent\. Send it again below\./);
    expect(html).toContain("Send the set-up email again");
  });

  it("agent already set a password: no invitation block, and no stale warning even with ?email=failed", async () => {
    vi.mocked(getAgencyInvitation).mockResolvedValue({ agentEmail: "new@test.local", pending: false });
    const html = await render({ email: "failed" });
    expect(html).not.toContain("Invited, not signed in yet");
    expect(html).not.toContain("Send the set-up email again");
    expect(html).not.toContain("could not be sent");
    expect(html).toContain("Available balance");
  });
});

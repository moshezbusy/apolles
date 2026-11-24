import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { btnPrimary, btnSecondary, link } from "@/components/ui";
import { getAgencyProfile } from "@/server/agency-profile";
import { BROWSER_COOKIE, readAuthRequest } from "@/server/assistant/oauth";
import { requireAgent } from "@/server/auth/guards";
import { getAccount } from "@/server/users";
import { allowAssistantAction, cancelAssistantAction } from "./actions";

export const metadata: Metadata = { title: "Connect an AI assistant · Apolles", robots: { index: false, follow: false } };

// Connecting Claude or ChatGPT (plan 2026-11-22-mcp-search-connector; mockup 20, "AI assistants").
// The agent is signed in as usual first (password, and the email code on a new device): this page
// asks for the agent session, and a signed-out agent comes back here after signing in. It names
// the assistant and the address it returns to, and says plainly what the assistant cannot do.
export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, agencyId } = await requireAgent();
  const { id } = await params;
  const nonce = (await cookies()).get(BROWSER_COOKIE)?.value;
  const [request, account, agency] = await Promise.all([readAuthRequest(id, nonce), getAccount(userId, agencyId), getAgencyProfile(agencyId)]);

  if (!request) {
    return (
      <AuthShell eyebrow="AI assistants" title="This link has expired" subtitle="Start connecting again from Claude or ChatGPT, in this browser. The link works for 10 minutes.">
        <Link href="/settings?tab=assistants" className={link}>
          Back to AI assistants
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="AI assistants" title={`Connect ${request.clientName}`} subtitle={`${request.clientName} wants to search hotels in Apolles for you.`} wide>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted">Agency</dt>
        <dd className="text-ink">{agency?.name ?? ""}</dd>
        <dt className="text-muted">Signed in as</dt>
        <dd className="text-ink">{account?.email ?? ""}</dd>
        <dt className="text-muted">Returns to</dt>
        <dd className="font-semibold text-ink">{request.redirectHost}</dd>
      </dl>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[13px] font-bold text-ink">{request.clientName} can</p>
          <ul className="mt-1.5 list-disc pl-4 text-[12.5px] leading-relaxed text-muted">
            <li>Search hotels and rates</li>
            <li>Give you a link to open a result in Apolles</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[13px] font-bold text-ink">{request.clientName} can&apos;t</p>
          <ul className="mt-1.5 list-disc pl-4 text-[12.5px] leading-relaxed text-muted">
            <li>Book, cancel or issue vouchers</li>
            <li>See guests, clients or your balance</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-[12.5px] text-muted">
        Continue only if you started this yourself, from your own {request.clientName}. You can disconnect it any time in Agency settings, AI assistants.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <form action={allowAssistantAction}>
          <input type="hidden" name="request" value={request.id} />
          <button type="submit" className={btnPrimary}>
            Allow search only
          </button>
        </form>
        <form action={cancelAssistantAction}>
          <input type="hidden" name="request" value={request.id} />
          <button type="submit" className={btnSecondary}>
            Cancel
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

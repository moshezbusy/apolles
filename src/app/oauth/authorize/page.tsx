import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { alertError, btnPrimary, btnSecondary } from "@/components/ui";
import { getAgencyProfile } from "@/server/agency-profile";
import { requireAgent } from "@/server/auth/guards";
import { assistantConfig } from "@/server/assistant/config";
import { ACCESS_TOKEN_TTL_MS, parseAuthorizeRequest, redirectWith } from "@/server/assistant/oauth";
import { allowAssistantAction, denyAssistantAction } from "./actions";
import { AUTHORIZE_KEYS } from "./params";

export const metadata: Metadata = { title: "Connect an AI assistant · Apolles", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// OAuth consent for the search-only AI assistant connector (plan 2026-11-22). Opened by Claude
// or ChatGPT. The request is checked before anything else: a client or redirect URI that is not
// on the fixed list gets an error page and is never redirected to. Then the agent session is
// checked (requireAgent sends a signed-out agent to sign in; the agent then presses Connect in
// the assistant again).
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const config = assistantConfig();
  if (!config) notFound();
  const params = await searchParams;
  const parsed = parseAuthorizeRequest(params, config);
  if (!parsed.ok && !parsed.redirectable) {
    return (
      <AuthShell eyebrow="AI assistant" title="Connection not possible">
        <p role="alert" className={alertError}>
          {parsed.message}
        </p>
      </AuthShell>
    );
  }
  if (!parsed.ok) redirect(redirectWith(parsed.redirectUri, { error: parsed.error, state: parsed.state }, config.issuer));

  const { agencyId } = await requireAgent();
  const profile = await getAgencyProfile(agencyId);
  if (!profile) throw new Error("Agency not found for the signed-in agent");
  const days = Math.round(ACCESS_TOKEN_TTL_MS / 86_400_000);
  const { clientName } = parsed.request;

  return (
    <AuthShell eyebrow="AI assistant" title={`Connect ${clientName}`} subtitle={`${clientName} asks to search hotels in Apolles for ${profile.name}.`}>
      <p className="rounded-[9px] border border-[#d3e3da] bg-brand-soft px-3 py-2.5 text-sm font-semibold text-brand">
        Search only. Bookings, cancellations and your balance can&apos;t be reached.
      </p>
      <div className="mt-4 grid gap-3 text-[13px] text-muted sm:grid-cols-2">
        <div>
          <p className="font-semibold text-ink">{clientName} can</p>
          <ul className="mt-1 list-disc pl-4">
            <li>Search hotels and rates</li>
            <li>Link to a result in Apolles, where you book</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-ink">{clientName} can&apos;t</p>
          <ul className="mt-1 list-disc pl-4">
            <li>Book, cancel or issue vouchers</li>
            <li>See guests, clients or your balance</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        The connection lasts {days} days. You can remove it any time in Agency settings, AI assistants.
      </p>
      <form action={allowAssistantAction} className="mt-5 flex flex-wrap gap-3">
        {AUTHORIZE_KEYS.map((key) => {
          const value = params[key];
          return typeof value === "string" ? <input key={key} type="hidden" name={key} value={value} /> : null;
        })}
        <button type="submit" className={btnPrimary}>
          Allow search
        </button>
        <button type="submit" formAction={denyAssistantAction} className={btnSecondary}>
          Cancel
        </button>
      </form>
    </AuthShell>
  );
}

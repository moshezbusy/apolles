import { agentHeader } from "@/app/(agent)/_components/agent-chrome";
import { currentAgent } from "@/server/auth/guards";

// Shell of pages opened from a link sent outside Apolles (plan 11: an assistant's result link).
// Unlike the (agent) layout it never redirects: a layout gets no searchParams, so its redirect
// to sign-in would lose the link, and it would win over the page's own. Each page here calls
// requireAgent({ returnTo }) itself, which sends the agent back to the same link afterwards.
// A signed-in agent sees the same header as on every agent page.
export default async function LinkLayout({ children }: { children: React.ReactNode }) {
  const agent = await currentAgent();
  return (
    <>
      {agent ? await agentHeader(agent.agencyId) : null}
      {children}
    </>
  );
}

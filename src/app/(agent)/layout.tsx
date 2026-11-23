import { agentHeader } from "@/app/(agent)/_components/agent-chrome";
import { requireAgent } from "@/server/auth/guards";

// Shell of every agent page. It checks the session for the header's data; each page still
// calls requireAgent() itself (a layout is not re-run on every navigation, and must never be
// the only check). The agencyId comes only from the session.
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const { agencyId } = await requireAgent();
  return (
    <>
      {await agentHeader(agencyId)}
      {children}
    </>
  );
}

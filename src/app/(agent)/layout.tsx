import { Header } from "@/components/Header";
import { requireAgent } from "@/server/auth/guards";
import { forAgency } from "@/server/scope";
import { getBalance } from "@/server/wallet/ledger";
import { countQuotesWithNewSelections } from "@/server/quotes/quotes";

// Shell of every agent page. It checks the session for the header's data; each page still
// calls requireAgent() itself (a layout is not re-run on every navigation, and must never be
// the only check). The agencyId comes only from the session.
export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const { agencyId } = await requireAgent();
  const [agency, balance, newSelections] = await Promise.all([forAgency(agencyId).agency.profile(), getBalance(agencyId), countQuotesWithNewSelections(agencyId)]);

  return (
    <>
      <Header agencyName={agency?.name ?? ""} balanceCents={balance.balanceCents} newSelections={newSelections} />
      {children}
    </>
  );
}

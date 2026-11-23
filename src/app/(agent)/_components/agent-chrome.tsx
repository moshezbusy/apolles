import { Header } from "@/components/Header";
import { forAgency } from "@/server/scope";
import { getBalance } from "@/server/wallet/ledger";

// The agent header, with the agency's name and balance: used by the (agent) layout and by the
// (link) layout (the assistant result link, which must do its own sign-in redirect). The
// agencyId comes only from the session, read by the caller. A plain async function, not an
// async component, so the layouts await the data themselves.
export async function agentHeader(agencyId: string): Promise<React.ReactElement> {
  const [agency, balance] = await Promise.all([forAgency(agencyId).agency.profile(), getBalance(agencyId)]);
  return <Header agencyName={agency?.name ?? ""} balanceCents={balance.balanceCents} />;
}

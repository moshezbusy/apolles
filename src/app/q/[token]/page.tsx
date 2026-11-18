import type { Metadata } from "next";
import { clientQuote } from "@/server/quotes/sharing";
import { Gone, Proposal, proposalPhotos } from "./proposal";

export const metadata: Metadata = { title: "Your travel proposal", robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;

// The client page (screens 16 English, 17 Hebrew). Public: the token in the URL opens one quote,
// in the agency's name and with its logo; Apolles and the supplier are not shown (GR1). Prices are
// the agency's selling prices in USD only (owner, 17.11.2026), never the net.
export default async function ClientQuotePage({ params }: { params: Params }) {
  const { token } = await params;
  const quote = await clientQuote(token);
  if (!quote) return <Gone />;
  return <Proposal quote={quote} token={token} logoSrc={`/q/${token}/logo`} photos={await proposalPhotos(quote)} />;
}

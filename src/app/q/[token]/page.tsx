import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getClientIp } from "@/server/client-ip";
import { clientPageAllowed, clientQuote, clientQuoteMeta } from "@/server/quotes/sharing";
import { Busy, Proposal, proposalPhotos } from "./proposal";

type Params = Promise<{ token: string }>;

// The tab title and link preview of a client link: the agency (as the client knows it) and the
// quote's name. Nothing of Apolles: the description is emptied so the site's own ("B2B hotel
// booking for travel agents") never shows in a WhatsApp or email preview, and the page is never
// indexed.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params;
  const meta = await clientQuoteMeta(token);
  const title = meta ? [meta.agencyName, meta.title].filter(Boolean).join(" · ") : "Travel proposal";
  return {
    title,
    description: "",
    robots: { index: false, follow: false },
    openGraph: { title, description: "", locale: meta?.language === "HE" ? "he_IL" : "en_US" },
  };
}

// The client page (screens 16 English, 17 Hebrew). Public: the token in the URL opens one quote,
// in the agency's name and with its logo; Apolles and the supplier are not shown (GR1). Prices are
// the agency's selling prices in USD only (owner, 17.11.2026), never the net. Opening it is
// limited per IP (whatever the link), and it reads hotel photos from our own cache only: a public
// page never makes a call to the supplier.
export default async function ClientQuotePage({ params }: { params: Params }) {
  const { token } = await params;
  if (!(await clientPageAllowed(getClientIp(await headers())))) return <Busy />;
  const data = await clientQuote(token);
  if (!data) notFound();
  return <Proposal quote={data.view} token={token} logoSrc={`/q/${token}/logo`} photos={await proposalPhotos(data, "cache")} />;
}

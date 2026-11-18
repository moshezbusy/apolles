import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { alertInfo, link } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { clientQuoteForAgency } from "@/server/quotes/sharing";
import { Proposal, proposalPhotos } from "../../../../q/[token]/proposal";

export const metadata: Metadata = { title: "Preview | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// "Preview" on the quote editor: the client page exactly as the client will see it, for the
// agency's own quote. Nothing is counted as a view and nothing can be sent from here.
export default async function QuotePreviewPage({ params }: { params: Params }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const data = await clientQuoteForAgency(agencyId, id);
  if (!data) notFound();
  return (
    <>
      <div className="mx-auto w-[min(1000px,calc(100%-32px))] pt-4">
        <p className={alertInfo}>
          Preview: this is what your client sees. <Link href={`/quotes/${id}`} className={link}>Back to the quote</Link>
        </p>
      </div>
      <Proposal quote={data.view} token={null} logoSrc="/settings/logo" photos={await proposalPhotos(data)} />
    </>
  );
}

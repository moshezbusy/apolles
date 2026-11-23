import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card, link, pageTitle } from "@/components/ui";
import { countryOptions } from "@/lib/countries";
import { requireAgent } from "@/server/auth/guards";
import { getQuote, quoteCode } from "@/server/quotes/quotes";
import { ClientForm } from "../../../clients/client-form";
import { createClientForQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "New client | Apolles", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

// "+ Add a new client" on the quote (mockup 15): the client is saved to Clients, then the quote
// opens again with the new client chosen. Cancel goes back to the quote unchanged.
export default async function NewClientForQuotePage({ params }: { params: Params }) {
  const { agencyId } = await requireAgent();
  const { id } = await params;
  const quote = await getQuote(agencyId, id);
  if (!quote) notFound();
  const agency = quote.agency.country;
  return (
    <main className="mx-auto flex w-[min(640px,calc(100%-40px))] flex-col gap-5 pb-16 pt-6">
      <Link href={`/quotes/${quote.id}`} className={link}>
        ← Back to {quoteCode(quote.number)}
      </Link>
      <h1 className={pageTitle}>New client</h1>
      <p className="text-sm text-muted">Saved to Clients and chosen on {quoteCode(quote.number)}. Save the quote after that to keep the choice.</p>
      <section className={`${card} bg-white p-5`}>
        <ClientForm
          action={createClientForQuoteAction.bind(null, quote.id)}
          values={{ firstName: "", lastName: "", phone: "", email: "", nationality: agency, notes: "" }}
          countries={countryOptions()}
          cancelHref={`/quotes/${quote.id}`}
        />
      </section>
    </main>
  );
}

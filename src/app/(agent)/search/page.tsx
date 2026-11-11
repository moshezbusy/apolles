import type { Metadata } from "next";
import { card, pageTitle } from "@/components/ui";
import { requireAgent } from "@/server/auth/guards";
import { startSearchAction } from "./actions";
import { SearchForm } from "./search-form";
import { dateRange, defaultSearchValues } from "./dates";

export const metadata: Metadata = { title: "Search | Apolles" };

// Screen 07: hotel search. Phase 1 has no recent searches and no quotes (phase 2).
export default async function SearchPage() {
  await requireAgent();
  const now = new Date();
  const { minDate, maxDate } = dateRange(now);
  return (
    <main className="mx-auto w-[min(1260px,calc(100%-40px))] py-10">
      <h1 className={pageTitle}>Hotel search</h1>
      <p className="mt-1 text-sm text-muted">Search live hotel availability and rates.</p>
      <section className={`${card} mt-6 p-5`}>
        <SearchForm action={startSearchAction} values={defaultSearchValues(now)} minDate={minDate} maxDate={maxDate} />
      </section>
    </main>
  );
}

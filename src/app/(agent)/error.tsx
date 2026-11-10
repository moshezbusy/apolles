"use client";

import Link from "next/link";
import { btnPrimary, card, link } from "@/components/ui";

// Shown instead of the browser's bare "Application error" when something in the agent area
// fails (for example a request the server refuses as too large). The error's own message is
// never shown: it may contain internal details.
export default function AgentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className={`w-full max-w-[460px] p-6 text-center ${card}`}>
        <h1 className="mb-2 font-serif text-[28px] font-medium leading-tight text-ink">Something went wrong</h1>
        <p className="mb-6 text-sm text-muted">Nothing was changed. Please try again. If it keeps happening, contact Apolles support.</p>
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={reset} className={btnPrimary}>
            Try again
          </button>
          <Link href="/balance" className={link}>
            Go to balance
          </Link>
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { formatUsd } from "@/lib/money";

// Agent header. Search, Quotes and Reporting are placeholders until later plans build them:
// shown, but not links. Bookings arrives in plan 3. The agency menu is a plain <details>
// element, so it needs no client JavaScript.
const COMING_SOON = ["Search", "Quotes", "Reporting"] as const;

export function Header({ agencyName, balanceCents }: { agencyName: string; balanceCents: number }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <span className="text-lg font-semibold tracking-tight text-gray-900">Apolles</span>

        <nav aria-label="Main" className="flex items-center gap-4 text-sm">
          {COMING_SOON.map((item) => (
            <span
              key={item}
              aria-disabled="true"
              title="Coming soon"
              className="cursor-not-allowed text-gray-400"
            >
              {item} <span className="text-xs">Coming soon</span>
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 text-sm">
          <Link
            href="/balance"
            className="rounded-md border border-gray-200 px-3 py-1.5 font-medium tabular-nums text-gray-900 hover:bg-gray-50"
          >
            {formatUsd(balanceCents)}
          </Link>

          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md px-2 py-1.5 font-medium text-gray-900 hover:bg-gray-50">
              {agencyName}
            </summary>
            <div className="absolute right-0 z-10 mt-1 flex w-48 flex-col rounded-md border border-gray-200 bg-white py-1 shadow-md">
              <Link href="/balance" className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                Balance &amp; top-ups
              </Link>
              <form method="post" action="/logout">
                <button
                  type="submit"
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50"
                >
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

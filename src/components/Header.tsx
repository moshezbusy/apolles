import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { formatUsd } from "@/lib/money";

// Agent header (mockup 07). Search, Quotes and Reporting are placeholders until later plans
// build them: shown, but not links. Bookings arrives in plan 3. The agency menu is a plain
// <details> element, so it needs no client JavaScript.
const COMING_SOON = ["Search", "Quotes", "Reporting"] as const;

// "Test Travel" → "TT", "Caryotrip" → "CA". Shown in the avatar circle.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join("") : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

export function Header({ agencyName, balanceCents }: { agencyName: string; balanceCents: number }) {
  return (
    <header className="sticky top-0 z-30 h-[68px] border-b border-line bg-white">
      <div className="mx-auto flex h-full w-[min(1260px,calc(100%-40px))] items-center gap-4 sm:gap-7">
        <span className="font-serif text-[22px] text-ink sm:text-[27px]">Apolles</span>

        <nav aria-label="Main" className="hidden h-full items-center gap-6 text-[13px] lg:flex">
          {COMING_SOON.map((item) => (
            <span
              key={item}
              aria-disabled="true"
              title="Coming soon"
              className="flex cursor-not-allowed items-center gap-1.5 text-[#9aa29e]"
            >
              {item} <span className="rounded-full bg-[#f1efe9] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a938e]">Coming soon</span>
            </span>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3.5">
          {/* The amount is the link's first text (screen readers say it first); the small
              "Balance" label is drawn above it with flex-col-reverse, as in the mockup. */}
          <Link
            href="/balance"
            className="flex flex-col-reverse items-end rounded-[10px] border border-[#dce6e0] bg-[#f7faf8] px-[11px] py-1.5 text-[12.5px] font-bold leading-tight tabular-nums text-brand hover:border-[#bcd0c6]"
          >
            {formatUsd(balanceCents)}
            <small className="text-[11px] font-semibold text-muted">Balance</small>
          </Link>

          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[12.5px] text-[#4d5a54]">
              <span
                aria-hidden="true"
                className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#e5eee9] text-[11px] font-extrabold text-brand"
              >{initials(agencyName)}</span>
              <span className="sr-only sm:not-sr-only sm:max-w-[220px] sm:truncate">{agencyName}</span>
              <span aria-hidden="true" className="text-[11px] text-[#8a938e]">
                ▾
              </span>
            </summary>
            <div className="absolute right-0 z-40 mt-2.5 flex w-[190px] flex-col rounded-[11px] border border-[#e1e6e3] bg-white p-[7px] shadow-[0_15px_38px_rgba(19,47,39,0.14)]">
              <Link
                href="/balance"
                className="rounded-[7px] px-2.5 py-2 text-[12.5px] text-[#4d5a54] hover:bg-[#f1f6f3] hover:text-brand"
              >
                Balance &amp; top-ups
              </Link>
              <div className="mx-0.5 my-[5px] h-px bg-[#eeeae5]" />
              <SignOutButton className="w-full rounded-[7px] px-2.5 py-2 text-left text-[12.5px] text-[#4d5a54] hover:bg-[#f1f6f3] hover:text-brand" />
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

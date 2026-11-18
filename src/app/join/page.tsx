import type { Metadata } from "next";
import Link from "next/link";
import { card, eyebrow } from "@/components/ui";
import { countryOptions } from "@/lib/countries";
import { joinAction } from "./actions";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join Apolles | Travel Agent Access" };

const STEPS = [
  "Submit your agency details.",
  "We verify your travel business.",
  "Once approved, you get an email with a link to set your password and sign in.",
];

// Screen 02: apply for free access. Public; the application is reviewed by Apolles before any
// account exists.
export default function JoinPage() {
  return (
    <div className="flex flex-1 flex-col bg-[radial-gradient(circle_at_85%_10%,rgba(184,145,85,0.12),transparent_25%),linear-gradient(180deg,#fbf8f0_0%,#fffdf8_55%)]">
      <header className="border-b border-line/80 bg-paper/95">
        <div className="mx-auto flex h-[72px] w-[min(1180px,calc(100%-40px))] items-center">
          <Link href="/" className="font-serif text-[27px] text-ink">
            Apolles
          </Link>
          <Link href="/login" className="ml-auto text-[13px] font-semibold text-[#4d5a54] hover:text-brand">
            Agent Login
          </Link>
        </div>
      </header>
      <main className="mx-auto grid w-[min(1100px,calc(100%-40px))] flex-1 gap-10 py-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className={eyebrow}>Travel professional access</p>
          <h1 className="mt-3 font-serif text-[44px] leading-none text-ink">Join Apolles</h1>
          <p className="mt-3 text-[15px] text-[#4d5a54]">Apply for free access to the Apolles hotel booking platform. Access is reviewed before activation.</p>
          <ol className="mt-6 flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3 text-[14px] text-ink">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-paper">{String(i + 1).padStart(2, "0")}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <section className={`${card} p-6`}>
          <h2 className="text-lg font-bold text-ink">Apply for access</h2>
          <p className="mb-5 mt-1 text-[13px] text-muted">Tell us a little about your travel business.</p>
          <JoinForm action={joinAction} countries={countryOptions()} />
        </section>
      </main>
    </div>
  );
}

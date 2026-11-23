import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

export const metadata: Metadata = { title: "Application received | Apolles", robots: { index: false, follow: false } };

const STEPS = [
  { title: "Application submitted", text: "Your details are on file." },
  { title: "Agency review", text: "Usually within 2 to 3 business days." },
  { title: "Set your password", text: "Once approved, you get an email with a link to set your password and sign in. The link works for 72 hours." },
];

// Screen 03. The email address is not shown (it is not put in the URL).
export default function ApplicationReceivedPage() {
  return (
    <AuthShell eyebrow="✓ Application received" title="Thanks for applying" subtitle="We sent a confirmation to your business email and will review your agency details before activating your account." wide>
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${i === 0 ? "bg-brand text-paper" : "bg-brand-soft text-brand"}`}>{i + 1}</span>
            <span>
              <strong className="block text-[14px] text-ink">
                Step {i + 1} · {s.title}
              </strong>
              <span className="text-[13px] text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[13px] text-muted">No action is needed right now. If we need more details, we will email you. Please check your spam folder if you don&apos;t see our emails.</p>
      <Link href="/" className="mt-5 block text-center text-sm font-semibold text-brand hover:underline">
        Return to Apolles.com
      </Link>
    </AuthShell>
  );
}

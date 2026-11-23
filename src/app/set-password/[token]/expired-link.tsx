import Link from "next/link";
import { btnPrimary } from "@/components/ui";

// Shown for any link that cannot be used (unknown, used, expired). A set-up link (the
// invitation a new account gets) is named as such, with how to get a new one: "Forgot
// password" sends a fresh set-up link to an account that has no password yet. The page never
// says which of unknown, used or expired it was.
export function ExpiredLink({ invitation = false }: { invitation?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em] text-ink">
        {invitation ? "This set-up link has expired" : "This link has expired"}
      </h1>
      <p className="text-sm text-muted">
        {invitation
          ? "Set-up links work for 72 hours and can be used once. Enter your email on the next page and we will send you a new one."
          : "Reset links work for 60 minutes and can be used once."}
      </p>
      <Link href="/forgot-password" className={`w-full ${btnPrimary}`}>
        Send a new link
      </Link>
    </div>
  );
}

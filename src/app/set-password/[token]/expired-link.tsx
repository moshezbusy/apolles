import Link from "next/link";
import { btnPrimary } from "@/components/ui";

// Shown for any link that cannot be used (unknown, used, expired). Same text for every case.
export function ExpiredLink() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em] text-ink">
        This link has expired
      </h1>
      <p className="text-sm text-muted">Links work for 60 minutes and can be used once.</p>
      <Link href="/forgot-password" className={`w-full ${btnPrimary}`}>
        Send a new link
      </Link>
    </div>
  );
}

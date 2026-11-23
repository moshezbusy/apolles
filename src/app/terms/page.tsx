import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { link } from "@/components/ui";

export const metadata: Metadata = { title: "Terms and conditions | Apolles" };

// Apolles' agent terms (GR3 links here from review & book). The legal text comes from the
// owner; until then this page says so plainly instead of showing made-up terms. In the same frame
// as the other public pages, with a way back.
export default function TermsPage() {
  return (
    <AuthShell title="Terms and conditions" wide headerLink={{ href: "/", label: "Back to Apolles" }}>
      <p className="text-sm text-[#37413d]">The full Apolles terms and conditions for travel agents will be published on this page before bookings open.</p>
      <p className="mt-4 flex flex-wrap gap-4 border-t border-[#f2ede6] pt-4">
        <Link href="/search" className={link}>
          Back to search
        </Link>
        <Link href="/" className={link}>
          Back to the home page
        </Link>
      </p>
    </AuthShell>
  );
}

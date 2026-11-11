import type { Metadata } from "next";
import { pageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Terms and conditions | Apolles" };

// Apolles' agent terms (GR3 links here from review & book). The legal text comes from the
// owner; until then this page says so plainly instead of showing made-up terms.
export default function TermsPage() {
  return (
    <main className="mx-auto w-[min(800px,calc(100%-40px))] py-10">
      <h1 className={pageTitle}>Terms and conditions</h1>
      <p className="mt-4 text-sm text-[#37413d]">The full Apolles terms and conditions for travel agents will be published on this page before bookings open.</p>
    </main>
  );
}

import type { Metadata } from "next";
import { alertInfo, card, pageTitle, sectionTitle } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guards";
import { RECOVERY_CODE_COUNT, countUnusedRecoveryCodes } from "@/server/auth/recovery-codes";
import { freshlySignedIn } from "./fresh";
import { RecoveryCodesForm } from "./recovery-form";

export const metadata: Metadata = { title: "Security · Admin · Apolles", robots: { index: false, follow: false } };

// Admin security: recovery codes for signing in when the phone with the authenticator app is
// lost. A new admin lands here right after setting up the authenticator.
export default async function SecurityPage() {
  const { userId } = await requireAdmin();
  const [unused, fresh] = await Promise.all([countUnusedRecoveryCodes(userId), freshlySignedIn()]);
  return (
    <main className="mx-auto w-[min(760px,calc(100%-40px))] flex-1 py-8">
      <h1 className={pageTitle}>Security</h1>
      <section aria-labelledby="recovery-title" className={`${card} mt-5 bg-white p-6`}>
        <h2 id="recovery-title" className={sectionTitle}>
          Recovery codes
        </h2>
        <p className="mt-2 text-sm text-ink">
          If you lose the phone with your authenticator app, sign in with one of these codes instead of the 6-digit code. Each code works once.
        </p>
        <p className="mt-3 text-sm font-semibold text-ink">
          {unused === 0 ? "You have no recovery codes." : `${unused} of ${RECOVERY_CODE_COUNT} codes unused.`}
        </p>
        {unused === 0 ? (
          <p role="status" className={`${alertInfo} mt-3`}>
            Make your recovery codes now, so that a lost phone does not lock you out of the admin.
          </p>
        ) : null}
        <div className="mt-4">
          <RecoveryCodesForm unused={unused} needCode={!fresh} />
        </div>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SignOutButton } from "@/components/SignOutButton";
import { link } from "@/components/ui";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { verifyRecoveryCodeAction, verifyTotpAction } from "./actions";
import { RecoveryCodeForm, TotpCodeForm } from "./code-form";

export const metadata: Metadata = {
  title: "Two-step verification · Apolles",
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage() {
  const { totpConfirmed } = await requireAdminPendingTotp();
  if (!totpConfirmed) redirect("/admin/2fa/setup");

  return (
    <AuthShell
      eyebrow="Admin"
      title="Two-step verification"
      subtitle="Enter the 6-digit code from your authenticator app."
    >
      <TotpCodeForm action={verifyTotpAction} />

      {/* Lost phone: one of the recovery codes made after setup (security page). */}
      <details className="mt-4 border-t border-[#f2ede6] pt-3.5">
        <summary className={`${link} cursor-pointer`}>Lost your phone? Use a recovery code</summary>
        <div className="mt-3">
          <RecoveryCodeForm action={verifyRecoveryCodeAction} />
        </div>
      </details>

      {/* Half signed in (password done, code not yet): Sign out ends this session. */}
      <div className="mt-4 border-t border-[#f2ede6] pt-3.5 text-center">
        <SignOutButton className={link} />
      </div>
    </AuthShell>
  );
}

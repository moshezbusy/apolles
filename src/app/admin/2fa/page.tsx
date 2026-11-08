import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { verifyTotpAction } from "./actions";
import { TotpCodeForm } from "./code-form";

export const metadata: Metadata = {
  title: "Two-step verification · Apolles",
  robots: { index: false, follow: false },
};

export default async function TwoFactorPage() {
  const { totpConfirmed } = await requireAdminPendingTotp();
  if (!totpConfirmed) redirect("/admin/2fa/setup");

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Two-step verification</h1>
        <p className="mb-6 text-sm text-gray-600">Enter the 6-digit code from your authenticator app.</p>
        <TotpCodeForm action={verifyTotpAction} />

        {/* Half signed in (password done, code not yet): Sign out ends this session. */}
        <div className="mt-6 border-t border-gray-200 pt-4">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

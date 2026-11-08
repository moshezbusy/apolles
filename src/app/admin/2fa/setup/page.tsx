import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { groupSecret, secretFromOtpauthUrl, startTotpEnrollment } from "@/server/auth/totp";
import { TotpCodeForm } from "../code-form";
import { confirmTotpAction, regenerateTotpKeyAction } from "./actions";

export const metadata: Metadata = {
  title: "Set up two-step verification · Apolles",
  robots: { index: false, follow: false },
};

// Shown until the admin confirms a code. A reload shows the same key; only the
// "Generate a new key" button replaces it (the previous, unconfirmed one then stops working).
export default async function TwoFactorSetupPage() {
  const { userId, totpConfirmed } = await requireAdminPendingTotp();
  if (totpConfirmed) redirect("/admin/2fa");

  const { otpauthUrl } = await startTotpEnrollment(userId);
  const secret = secretFromOtpauthUrl(otpauthUrl);

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Set up two-step verification</h1>
        <p className="mb-6 text-sm text-gray-600">
          Add this key to your authenticator app, then enter the 6-digit code.
        </p>

        <p className="text-sm font-medium text-gray-700">Key</p>
        <p className="mb-4 rounded-md bg-gray-100 px-3 py-2 font-mono text-lg tracking-wide text-gray-900">
          {groupSecret(secret)}
        </p>

        <p className="text-sm font-medium text-gray-700">Setup link (otpauth)</p>
        <p className="mb-6 break-all rounded-md bg-gray-100 px-3 py-2 font-mono text-xs text-gray-700">
          {otpauthUrl}
        </p>

        <TotpCodeForm action={confirmTotpAction} />

        <form action={regenerateTotpKeyAction} className="mt-6 border-t border-gray-200 pt-4">
          <button type="submit" className="text-sm text-blue-700 hover:underline">
            Generate a new key
          </button>
        </form>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SignOutButton } from "@/components/SignOutButton";
import { link } from "@/components/ui";
import { requireAdminPendingTotp } from "@/server/auth/guards";
import { groupSecret, secretFromOtpauthUrl, startTotpEnrollment } from "@/server/auth/totp";
import { totpQrSvgDataUri } from "@/server/auth/totp-qr";
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
  const qrSrc = totpQrSvgDataUri(otpauthUrl);

  return (
    <AuthShell
      wide
      eyebrow="Admin"
      title="Set up two-step verification"
      subtitle="Add this key to your authenticator app, then enter the 6-digit code."
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a server-made SVG data URI; next/image adds nothing here */}
      <img
        src={qrSrc}
        alt="QR code for your authenticator app"
        width={192}
        height={192}
        className="mx-auto mb-3 h-48 w-48 rounded-lg border border-line bg-white p-2"
      />
      <p className="mb-4 text-center text-[13px] text-muted">Can&apos;t scan? Enter this key instead.</p>

      <p className="mb-1.5 text-xs font-semibold text-[#37413d]">Key</p>
      <p className="mb-4 rounded-lg border border-line bg-cream px-3 py-2 font-mono text-lg tracking-wide text-ink">
        {groupSecret(secret)}
      </p>

      <p className="mb-1.5 text-xs font-semibold text-[#37413d]">Setup link (otpauth)</p>
      <p className="mb-5 break-all rounded-lg border border-line bg-cream px-3 py-2 font-mono text-xs text-[#4d5a54]">
        {otpauthUrl}
      </p>

      <TotpCodeForm action={confirmTotpAction} />

      {/* Two separate forms (a form cannot hold another). Sign out ends this half-signed-in session. */}
      <div className="mt-4 flex items-center justify-between border-t border-[#f2ede6] pt-3.5">
        <form action={regenerateTotpKeyAction}>
          <button type="submit" className={link}>
            Generate a new key
          </button>
        </form>
        <SignOutButton className={link} />
      </div>
    </AuthShell>
  );
}

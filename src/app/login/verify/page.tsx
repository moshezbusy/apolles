import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { SignOutButton } from "@/components/SignOutButton";
import { requireAgentPendingCode } from "@/server/auth/guards";
import { safeReturnTo } from "@/server/auth/return-to";
import { resendCodeAction, verifyCodeAction } from "./actions";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Check your email · Apolles", robots: { index: false, follow: false } };

// Mockup 04, new device: the email code step (plan 8e). Only for an agent session that still
// waits for its code; the address is shown masked.
// `next` (plan 11): the assistant's connect page to go back to after the code.
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { email } = await requireAgentPendingCode();
  const next = safeReturnTo((await searchParams).next);
  const [name = "", domain = ""] = email.split("@");
  const masked = `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
  return (
    <AuthShell eyebrow="New device" title="Check your email" subtitle={`We sent a 6-digit code to ${masked}. It expires in 10 minutes.`}>
      <VerifyForm verify={verifyCodeAction} resend={resendCodeAction} next={next} />
      <div className="mt-4 border-t border-[#f2ede6] pt-3.5 text-center text-[12.5px] text-muted">
        Not you? <SignOutButton className="font-semibold text-brand hover:underline" />
      </div>
    </AuthShell>
  );
}

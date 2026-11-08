import type { Metadata } from "next";
import { findUsablePasswordToken } from "@/server/auth/password-tokens";
import { ExpiredLink } from "./expired-link";
import { SetPasswordForm } from "./set-password-form";

// The token is in the URL: keep the page out of search engines and never send it to
// another site in a Referer header.
export const metadata: Metadata = {
  title: "Set password · Apolles",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const TITLES = { SET: "Set your password", RESET: "Create a new password" } as const;

export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Only checks the link; it is used up when the form is submitted.
  const purpose = await findUsablePasswordToken(token);

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        {purpose ? <SetPasswordForm token={token} title={TITLES[purpose]} /> : <ExpiredLink />}
      </div>
    </main>
  );
}

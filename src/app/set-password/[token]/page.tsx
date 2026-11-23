import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { checkPasswordLink } from "@/server/auth/password-tokens";
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
  const link = await checkPasswordLink(token);
  const invitation = link.purpose === "SET";

  return (
    <AuthShell>
      {link.usable && link.purpose ? (
        <SetPasswordForm token={token} title={TITLES[link.purpose]} invitation={invitation} />
      ) : (
        <ExpiredLink invitation={invitation} />
      )}
    </AuthShell>
  );
}

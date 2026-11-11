import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { alertInfo, alertSuccess } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Apolles" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reset, expired } = await searchParams;

  return (
    <AuthShell eyebrow="Sign in" title="Welcome back" subtitle="Sign in to your Apolles account.">
      {reset === "1" ? (
        <p role="status" className={`mb-4 ${alertSuccess}`}>
          Your password is set. Sign in.
        </p>
      ) : null}
      {expired === "1" ? (
        <p role="status" className={`mb-4 ${alertInfo}`}>
          You were signed out. For your security, sessions end after 12 hours. Sign in again to continue.
        </p>
      ) : null}
      <LoginForm />
      <p className="mt-3 text-center text-xs text-muted">
        For your security, you are signed out automatically after 12 hours.
      </p>
    </AuthShell>
  );
}

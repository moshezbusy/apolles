import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { alertSuccess } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Apolles" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reset } = await searchParams;

  return (
    <AuthShell eyebrow="Sign in" title="Welcome back" subtitle="Sign in to your Apolles account.">
      {reset === "1" ? (
        <p role="status" className={`mb-4 ${alertSuccess}`}>
          Your password is set. Sign in.
        </p>
      ) : null}
      <LoginForm />
      <p className="mt-3 text-center text-xs text-[#8b928e]">
        For your security, you are signed out automatically after 12 hours.
      </p>
    </AuthShell>
  );
}

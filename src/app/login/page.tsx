import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { alertInfo, alertSuccess } from "@/components/ui";
import { safeReturnPath } from "@/lib/return-path";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Apolles" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reset, expired, code, next } = await searchParams;

  return (
    <AuthShell eyebrow="Agent portal" title="Welcome back" subtitle="Sign in to your Apolles account." headerLink={{ href: "/join", label: "Join Apolles" }}>
      {reset === "1" ? (
        <p role="status" className={`mb-4 ${alertSuccess}`}>
          Your password is set. For your security, other devices signed in to your account were signed out. Sign in.
        </p>
      ) : null}
      {code === "locked" ? (
        <p role="alert" className={`mb-4 ${alertInfo}`}>
          Too many wrong codes. For your security, sign in again to get a new code.
        </p>
      ) : null}
      {expired === "1" ? (
        <p role="status" className={`mb-4 ${alertInfo}`}>
          You were signed out. For your security, sessions end after 12 hours. Sign in again to continue.
        </p>
      ) : null}
      <LoginForm next={safeReturnPath(next) ?? undefined} />
      <p className="mt-3 text-center text-xs text-muted">
        For your security, you are signed out automatically after 12 hours.
      </p>
      <p className="mt-4 border-t border-[#f2ede6] pt-4 text-center text-[13px] text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/join" className="font-semibold text-brand hover:underline">
          Apply for access
        </Link>
      </p>
    </AuthShell>
  );
}

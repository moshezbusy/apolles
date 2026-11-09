import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password · Apolles",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Password help"
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to create a new password."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}

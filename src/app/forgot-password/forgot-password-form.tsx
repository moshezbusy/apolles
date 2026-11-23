"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertSuccess, btnPrimary, input, label } from "@/components/ui";
import { requestResetAction, type ForgotPasswordState } from "./actions";

export const FORGOT_PASSWORD_SENT_COPY =
  "If an account exists for this email, we sent a link to set a new password.";

const backLink = "self-center text-[12.5px] font-semibold text-brand hover:underline";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestResetAction,
    null,
  );

  if (state?.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className={alertSuccess}>
          {FORGOT_PASSWORD_SENT_COPY}
        </p>
        <ul className="flex flex-col gap-1 text-[13px] text-[#4d5a54]">
          <li>The link can be used once. The email says how long it works.</li>
          <li>Don&apos;t see it? Check your spam folder.</li>
        </ul>
        <a href="/forgot-password" className={backLink}>
          Send the email again
        </a>
        <Link href="/login" className={backLink}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3.5" noValidate>
      <label className={label}>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="name@agency.com"
          className={input}
        />
      </label>

      <button type="submit" disabled={pending} className={`w-full ${btnPrimary}`}>
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <div className="border-t border-[#f2ede6] pt-3.5 text-center">
        <Link href="/login" className={backLink}>
          Back to sign in
        </Link>
      </div>
    </form>
  );
}

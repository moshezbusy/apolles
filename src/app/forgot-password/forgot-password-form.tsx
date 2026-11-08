"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestResetAction, type ForgotPasswordState } from "./actions";

export const FORGOT_PASSWORD_SENT_COPY =
  "If an account exists for this email, we sent a reset link.";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestResetAction,
    null,
  );

  if (state?.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {FORGOT_PASSWORD_SENT_COPY}
        </p>
        <Link href="/login" className="self-start text-sm text-blue-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-gray-600">
        Enter your email and we will send you a link to create a new password.
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={254}
          className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <Link href="/login" className="self-start text-sm text-blue-700 hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

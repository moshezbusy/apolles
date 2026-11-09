"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, btnPrimary, input, label } from "@/components/ui";
import { loginAction, type LoginFormState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3.5" noValidate>
      {state?.error ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}

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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="login-password" className="text-xs font-semibold text-[#37413d]">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs font-semibold text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={256}
          placeholder="Enter your password"
          className={input}
        />
      </div>

      <button type="submit" disabled={pending} className={`w-full ${btnPrimary}`}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

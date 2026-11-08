"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginFormState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

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

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={256}
          className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <Link href="/forgot-password" className="self-start text-sm text-blue-700 hover:underline">
        Forgot password?
      </Link>
    </form>
  );
}

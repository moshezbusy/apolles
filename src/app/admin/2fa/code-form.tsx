"use client";

import { useActionState } from "react";
import type { TotpFormState } from "./form-state";

type TotpAction = (previous: TotpFormState, formData: FormData) => Promise<TotpFormState>;

export function TotpCodeForm({ action }: { action: TotpAction }) {
  const [state, formAction, pending] = useActionState<TotpFormState, FormData>(action, null);

  // Locked: the sessions are already ended. The page's own Sign out button (below this form)
  // clears the cookie and goes to /login; a plain link there would leave the cookie behind.
  if (state?.locked) {
    return (
      <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {state.error}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        6-digit code
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          className="rounded-md border border-gray-300 px-3 py-2 text-base tracking-widest text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

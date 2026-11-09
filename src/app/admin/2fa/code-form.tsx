"use client";

import { useActionState } from "react";
import { alertError, btnPrimary, codeInput, label } from "@/components/ui";
import type { TotpFormState } from "./form-state";

type TotpAction = (previous: TotpFormState, formData: FormData) => Promise<TotpFormState>;

export function TotpCodeForm({ action }: { action: TotpAction }) {
  const [state, formAction, pending] = useActionState<TotpFormState, FormData>(action, null);

  // Locked: the sessions are already ended. The page's own Sign out button (below this form)
  // clears the cookie and goes to /login; a plain link there would leave the cookie behind.
  if (state?.locked) {
    return (
      <p role="alert" className={alertError}>
        {state.error}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3.5" noValidate>
      {state?.error ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}

      <label className={label}>
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
          className={codeInput}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`w-full ${btnPrimary}`}
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

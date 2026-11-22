"use client";

import { useActionState } from "react";
import { alertError, btnPrimary, btnSecondary } from "@/components/ui";
import { allowAction, denyAction, type ConsentState } from "./actions";

// Allow / Deny of the connect page. The hidden fields are the checked authorize request; the
// actions check them again on the server.
export function ConsentForm({ fields }: { fields: Record<string, string> }) {
  const [state, allow, pending] = useActionState<ConsentState, FormData>(allowAction, null);
  return (
    <form action={allow} className="flex flex-col gap-3.5">
      {state?.error ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <button type="submit" formAction={denyAction} disabled={pending} className={`w-full sm:w-auto ${btnSecondary}`}>
          Deny
        </button>
        <button type="submit" disabled={pending} className={`w-full sm:w-auto ${btnPrimary}`}>
          Allow
        </button>
      </div>
    </form>
  );
}

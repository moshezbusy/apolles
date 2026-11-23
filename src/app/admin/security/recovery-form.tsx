"use client";

import { useActionState, useState } from "react";
import { alertError, alertInfo, alertSuccess, btnDanger, btnPrimary, btnSecondary, codeInput, label } from "@/components/ui";
import { createRecoveryCodesAction } from "./actions";
import type { RecoveryFormState } from "./form-state";

// Makes a new set of recovery codes. With codes already there, a second step says the old ones
// stop working. Asks for the authenticator code unless this session signed in a moment ago.
export function RecoveryCodesForm({ unused, needCode }: { unused: number; needCode: boolean }) {
  const [state, formAction, pending] = useActionState<RecoveryFormState, FormData>(createRecoveryCodesAction, null);
  const [confirming, setConfirming] = useState(false);

  if (state?.codes) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className={alertSuccess}>
          {state.message}
        </p>
        <ol className="grid gap-2 rounded-lg border border-line bg-cream p-4 font-mono text-[15px] tracking-wide text-ink sm:grid-cols-2">
          {state.codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <p className="text-xs text-muted">Keep them somewhere safe, away from your phone (printed, or in a password manager). Each code signs in once.</p>
      </div>
    );
  }

  const replacing = unused > 0;
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!replacing || confirming) return;
        event.preventDefault();
        setConfirming(true);
      }}
      className="flex flex-col gap-3"
    >
      {state?.status === "error" ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
      {needCode ? (
        <label className={`${label} max-w-[220px]`}>
          Code from your authenticator app
          <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={codeInput} />
        </label>
      ) : null}
      {confirming ? (
        <>
          <p role="status" className={alertInfo}>
            Make new codes? Your {unused} unused {unused === 1 ? "code stops" : "codes stop"} working at once.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={pending} className={btnDanger}>
              {pending ? "Making codes…" : "Replace my codes"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnSecondary}>
              Go back
            </button>
          </div>
        </>
      ) : (
        <div>
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "Making codes…" : replacing ? "Make new recovery codes" : "Make recovery codes"}
          </button>
        </div>
      )}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnPrimary, codeInput, label } from "@/components/ui";
import type { VerifyState } from "./copy";

export function VerifyForm({ verify, resend, next }: { verify: (p: VerifyState, f: FormData) => Promise<VerifyState>; resend: () => Promise<VerifyState>; next?: string }) {
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(verify, null);
  const [resent, resendAction, resending] = useActionState<VerifyState>(resend, null);
  const message = state ?? resent;
  return (
    <div className="flex flex-col gap-3.5">
      {message?.error ? (
        <p role="alert" className={alertError}>
          {message.error}
        </p>
      ) : message?.notice ? (
        <p role="status" className={alertSuccess}>
          {message.notice}
        </p>
      ) : null}
      <form action={formAction} className="flex flex-col gap-3.5" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label className={label}>
          6-digit code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={codeInput} />
        </label>
        <button type="submit" disabled={pending} className={`w-full ${btnPrimary}`}>
          {pending ? "Checking…" : "Verify and sign in"}
        </button>
      </form>
      <form action={resendAction} className="text-center">
        <button type="submit" disabled={resending} className="text-[12.5px] font-semibold text-brand hover:underline">
          Resend code
        </button>
      </form>
    </div>
  );
}

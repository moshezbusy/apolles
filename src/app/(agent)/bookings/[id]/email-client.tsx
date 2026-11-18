"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary, input, label } from "@/components/ui";

type State = { status: "success" | "error"; message: string } | null;
type Action = (previous: State, formData: FormData) => Promise<State>;

// "Email to client" (screen 12, plan 8g): the voucher goes to the address the agent types, in the
// agency's name, without any price.
export function EmailToClient({ action, bookingId, defaultEmail }: { action: Action; bookingId: string; defaultEmail: string }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, null);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-sm font-semibold text-brand">Email to client</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="bookingId" value={bookingId} />
        <label className={label}>
          Client email
          <input type="email" name="email" required maxLength={254} defaultValue={defaultEmail} autoComplete="off" className={input} />
        </label>
        <p className="text-xs text-muted">Sends the voucher in your agency&apos;s name. No prices are shown.</p>
        <button type="submit" disabled={pending} className={btnSecondary}>
          {pending ? "Sending…" : "Send voucher"}
        </button>
        {state ? (
          <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
            {state.message}
          </p>
        ) : null}
      </form>
    </details>
  );
}

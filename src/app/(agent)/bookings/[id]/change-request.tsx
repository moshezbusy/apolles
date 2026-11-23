"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary, input, label } from "@/components/ui";

type State = { status: "success" | "error"; message: string; text?: string } | null;
type Action = (previous: State, formData: FormData) => Promise<State>;

// "Request a change" (mockup 12): what should change, in the agent's words, sent to Apolles. After
// an error the text comes back; after a success the box is empty again.
export function ChangeRequestForm({ action, bookingId, maxLength }: { action: Action; bookingId: string; maxLength: number }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, null);
  return (
    <form key={state?.status === "success" ? state.message : "form"} action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className={label}>
        What should change
        <textarea name="text" rows={4} required maxLength={maxLength} defaultValue={state?.status === "error" ? (state.text ?? "") : ""} placeholder="e.g. Correct the second guest's family name to Cohen" className={input} />
      </label>
      <p className="text-xs text-muted">Apolles asks the hotel and tells you the result. Nothing changes until then.</p>
      <button type="submit" disabled={pending} className={`${btnSecondary} self-start`}>
        {pending ? "Sending…" : "Send change request"}
      </button>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

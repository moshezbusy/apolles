"use client";

import { useActionState } from "react";
import { alertError, alertInfo, alertSuccess, btnPrimary, input, label } from "@/components/ui";
import { markChangeRequestDoneAction } from "./actions";
import type { ChangeRequestFormState } from "./form-state";

export function MarkDoneForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState<ChangeRequestFormState, FormData>(markChangeRequestDoneAction, null);
  if (state?.status === "success") {
    return (
      <p role="status" className={alertSuccess}>
        {state.message}
      </p>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertInfo}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="requestId" value={requestId} />
      <label className={label}>
        Note (optional, the agent does not see it)
        <textarea name="note" rows={2} maxLength={1000} className={input} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Mark done"}
        </button>
      </div>
    </form>
  );
}

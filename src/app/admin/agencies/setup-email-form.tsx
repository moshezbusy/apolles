"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary } from "@/components/ui";
import type { SetupEmailState } from "./form-state";

type Action = (previous: SetupEmailState, formData: FormData) => Promise<SetupEmailState>;

// "Send the set-up email again": for an agent who was invited and has not set a password yet.
export function SetupEmailForm({ agencyId, action }: { agencyId: string; action: Action }) {
  const [state, formAction, pending] = useActionState<SetupEmailState, FormData>(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="agencyId" value={agencyId} />
      <button type="submit" disabled={pending} className={`self-start ${btnSecondary}`}>
        {pending ? "Sending…" : "Send the set-up email again"}
      </button>
    </form>
  );
}

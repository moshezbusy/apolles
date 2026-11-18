"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary, input, label } from "@/components/ui";
import type { ClientFormState } from "./form-state";

type Action = (previous: ClientFormState, formData: FormData) => Promise<ClientFormState>;

const EMPTY = { firstName: "", lastName: "", relation: "", childAge: "" };

// "+ Add" under Travel companions (mockup 18). Leave the age empty for an adult.
export function CompanionForm({ action, clientId }: { action: Action; clientId: string }) {
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(action, null);
  const shown = state?.status === "error" && state.values ? { ...EMPTY, ...state.values } : EMPTY;

  return (
    <details className="mt-2" open={state?.status === "error"}>
      <summary className="cursor-pointer list-none text-[13px] font-bold text-brand hover:underline">+ Add companion</summary>
      <form key={JSON.stringify(state)} action={formAction} className="mt-3 flex flex-col gap-3" noValidate>
        {state ? (
          <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
            {state.message}
          </p>
        ) : null}
        <input type="hidden" name="clientId" value={clientId} />
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            First name
            <input type="text" name="firstName" required maxLength={60} autoComplete="off" defaultValue={shown.firstName} className={input} />
          </label>
          <label className={label}>
            Last name
            <input type="text" name="lastName" required maxLength={60} autoComplete="off" defaultValue={shown.lastName} className={input} />
          </label>
          <label className={label}>
            Relation
            <input type="text" name="relation" maxLength={40} placeholder="Spouse" defaultValue={shown.relation} className={input} />
          </label>
          <label className={label}>
            Child age
            <input type="text" name="childAge" inputMode="numeric" maxLength={2} placeholder="Adult" defaultValue={shown.childAge} className={input} />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`self-start ${btnSecondary}`}>
          {pending ? "Adding…" : "Add companion"}
        </button>
      </form>
    </details>
  );
}

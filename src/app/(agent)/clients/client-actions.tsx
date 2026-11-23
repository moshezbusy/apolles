"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { alertError, btnDanger, btnSecondary, input, label } from "@/components/ui";
import type { ClientFormState } from "./form-state";

type MergeAction = (previous: ClientFormState, formData: FormData) => Promise<ClientFormState>;

function Submit({ className, text, pendingText }: { className: string; text: string; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : text}
    </button>
  );
}

// "Merge into another client" (the same person saved twice): this card's quotes and companions
// move to the client chosen here, then this card is deleted. Asks first.
export function MergeClient({ action, clientId, name, others }: { action: MergeAction; clientId: string; name: string; others: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<ClientFormState, FormData>(action, null);
  if (others.length === 0) return null;
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const select = event.currentTarget.elements.namedItem("keepId");
        const keep = select instanceof HTMLSelectElement ? select.selectedOptions[0]?.text : "";
        if (!keep || !window.confirm(`Merge ${name} into ${keep}? ${name}'s quotes and companions move to ${keep}, and ${name}'s card is deleted. This cannot be undone.`)) event.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <label className={label}>
        Merge into another client
        <select name="keepId" required defaultValue="" className={input}>
          <option value="" disabled>
            Choose the client to keep
          </option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <Submit className={`${btnSecondary} self-start`} text="Merge clients" pendingText="Merging…" />
      {state?.status === "error" ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

// "Delete client": asks first. The client's quotes stay, with no client.
export function DeleteClient({ action, clientId, name }: { action: (formData: FormData) => Promise<void>; clientId: string; name: string }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${name}? The card and the travel companions are deleted. Quotes made for ${name} stay, without a client. This cannot be undone.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="clientId" value={clientId} />
      <Submit className={`${btnDanger} self-start`} text="Delete client" pendingText="Deleting…" />
    </form>
  );
}

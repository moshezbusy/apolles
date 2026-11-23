"use client";

import { useFormStatus } from "react-dom";
import { link } from "@/components/ui";

// "Remove" next to a travel companion (mockup 18): asks first, and says it is removing while the
// action runs. Removing cannot be undone (the companion is added again by hand).
export function RemoveCompanion({ action, companionId, name }: { action: (formData: FormData) => Promise<void>; companionId: string; name: string }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Remove ${name} from this client's travel companions?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="companionId" value={companionId} />
      <RemoveButton name={name} />
    </form>
  );
}

function RemoveButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={link} aria-label={`Remove ${name}`}>
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

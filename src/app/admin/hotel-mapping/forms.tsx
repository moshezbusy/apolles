"use client";

import { useActionState } from "react";
import { alertError, alertInfo, alertSuccess, btnDanger, btnPrimary, btnSecondary, input, label } from "@/components/ui";
import { decideMappingAction, proposeMappingAction, removeMappingAction } from "./actions";
import type { MappingFormState } from "./form-state";

function Message({ state }: { state: MappingFormState }) {
  if (!state) return null;
  const style = state.status === "error" ? alertError : state.status === "success" ? alertSuccess : alertInfo;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={style}>
      {state.message}
    </p>
  );
}

// One hotel found by name: link it to a supplier layer hotel id (proposed, not live yet).
export function ProposeForm({ propertyId, layerHotelIds }: { propertyId: string; layerHotelIds: string[] }) {
  const [state, formAction, pending] = useActionState<MappingFormState, FormData>(proposeMappingAction, null);
  const listId = `layer-ids-${propertyId}`;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Message state={state} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>
          Supplier layer hotel id
          <input name="layerHotelId" required maxLength={100} list={listId} className={`${input} w-40`} />
          <datalist id={listId}>
            {layerHotelIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          Note (optional)
          <input name="note" maxLength={300} className={`${input} w-64`} />
        </label>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Proposing…" : "Propose link"}
        </button>
      </div>
    </form>
  );
}

// Approve or reject one link.
export function DecideForm({ mappingId, decision }: { mappingId: string; decision: "approve" | "reject" }) {
  const [state, formAction, pending] = useActionState<MappingFormState, FormData>(decideMappingAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Message state={state} />
      <input type="hidden" name="mappingId" value={mappingId} />
      <input type="hidden" name="decision" value={decision} />
      <div>
        <button type="submit" disabled={pending} className={decision === "approve" ? btnPrimary : btnSecondary}>
          {decision === "approve" ? (pending ? "Approving…" : "Approve link") : pending ? "Rejecting…" : "Reject link"}
        </button>
      </div>
    </form>
  );
}

// Remove one link: a confirmation box must be ticked first.
export function RemoveForm({ mappingId }: { mappingId: string }) {
  const [state, formAction, pending] = useActionState<MappingFormState, FormData>(removeMappingAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Message state={state} />
      <input type="hidden" name="mappingId" value={mappingId} />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="confirm" value="yes" required />
        Yes, remove this link
      </label>
      <div>
        <button type="submit" disabled={pending} className={btnDanger}>
          {pending ? "Removing…" : "Remove link"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { alertError, btnPrimary, btnSecondary } from "@/components/ui";
import type { ReviewState } from "./actions";

type Action = (previous: ReviewState, formData: FormData) => Promise<ReviewState>;

export function ReviewForms({ id, approve, reject }: { id: string; approve: Action; reject: Action }) {
  const [approveState, approveForm, approving] = useActionState<ReviewState, FormData>(approve, null);
  const [rejectState, rejectForm, rejecting] = useActionState<ReviewState, FormData>(reject, null);
  const error = approveState?.error ?? rejectState?.error;
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className={alertError}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <form action={approveForm}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={approving || rejecting} className={btnPrimary}>
            {approving ? "Approving…" : "Approve and open the agency"}
          </button>
        </form>
        <form
          action={rejectForm}
          onSubmit={(e) => {
            if (!window.confirm("Reject this application?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={approving || rejecting} className={btnSecondary}>
            {rejecting ? "Rejecting…" : "Reject"}
          </button>
        </form>
      </div>
      <p className="text-xs text-muted">Approve makes the agency and its agent login, and emails the contact a link to set a password. Reject sends no email.</p>
    </div>
  );
}

// For an application that was approved but whose agency was never opened (an interrupted
// approval): the same approve action completes it. Nothing to reject at this point.
export function FinishApprovalForm({ id, approve }: { id: string; approve: Action }) {
  const [state, approveForm, approving] = useActionState<ReviewState, FormData>(approve, null);
  return (
    <div className="flex flex-col gap-3">
      {state?.error ? (
        <p role="alert" className={alertError}>
          {state.error}
        </p>
      ) : null}
      <p className="text-sm text-muted">This application was approved, but opening the agency did not finish. Finish it here: the agency and its agent login are made, and the contact gets the set-up email.</p>
      <form action={approveForm}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={approving} className={`self-start ${btnPrimary}`}>
          {approving ? "Opening…" : "Finish opening the agency"}
        </button>
      </form>
    </div>
  );
}

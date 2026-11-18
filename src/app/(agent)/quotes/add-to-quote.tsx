"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary, input } from "@/components/ui";
import type { ActionState } from "./action-state";

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

// "Add to quote" on the hotel page (screen 09). It uses the rate row's own form (the search, the
// rate and the chosen bed type), so the agent picks the bed once for both buttons. The server
// reads the room and its price from the search; the browser only names them.
export function AddToQuote({
  formId,
  quotes,
  defaultQuoteId,
  action,
}: {
  formId: string;
  quotes: { id: string; label: string }[];
  defaultQuoteId: string | null;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const known = defaultQuoteId && quotes.some((q) => q.id === defaultQuoteId) ? defaultQuoteId : "new";
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <select form={formId} name="quoteId" defaultValue={known} aria-label="Quote" className={`${input} text-xs`}>
        <option value="new">New quote</option>
        {quotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <button type="submit" form={formId} formAction={formAction} disabled={pending} className={`${btnSecondary} w-full`}>
        {pending ? "Adding…" : "Add to quote"}
      </button>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
          {state.status === "success" && state.quoteId ? (
            <>
              {" "}
              <Link href={`/quotes/${state.quoteId}`} className="font-bold underline">
                Open the quote
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

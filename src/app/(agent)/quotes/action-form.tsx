"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { FormPending } from "./pending-button";
import { alertError, alertSuccess } from "@/components/ui";
import { useQuoteDirty } from "./[id]/dirty";
import type { ActionState } from "./action-state";

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

// What the form holds now, as text (the framework's own hidden fields left out).
function snapshot(form: HTMLFormElement | null): string {
  if (!form) return "";
  return JSON.stringify([...new FormData(form).entries()].filter(([key, value]) => !key.startsWith("$ACTION") && typeof value === "string"));
}

// One small form of the quote editor (a price, a date, a remove button). It shows the action's
// message next to it; on success the page data refreshes by itself (revalidatePath).
// `keepValues`: what the agent typed stays in the fields after the action answers (by default the
// browser form goes back to the saved values), so an answer that asks for a confirmation tick
// does not lose the price or the client it is about.
// `trackDirty`: tells the page (QuoteDirtyProvider) while the form holds unsaved changes.
export function ActionForm({
  action,
  children,
  className,
  id,
  confirmText,
  keepValues,
  trackDirty,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  id?: string;
  // A question asked before the form is sent (an action that ends something, like closing a quote).
  confirmText?: string | undefined;
  keepValues?: boolean;
  trackDirty?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const saved = useRef<string | null>(null);
  const { setDirty } = useQuoteDirty();

  // The saved values: what the form holds when it appears, and again after each successful save.
  useEffect(() => {
    if (!trackDirty) return;
    if (saved.current === null || state?.status === "success") {
      saved.current = snapshot(form.current);
      setDirty(false);
    }
  }, [trackDirty, state, setDirty]);
  useEffect(() => (trackDirty ? () => setDirty(false) : undefined), [trackDirty, setDirty]);

  const changed = trackDirty ? () => setDirty(snapshot(form.current) !== saved.current) : undefined;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    if (confirmText && !window.confirm(confirmText)) {
      event.preventDefault();
      return;
    }
    if (!keepValues) return;
    // Sent by hand instead of as a browser form post: the fields keep what was typed.
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={form} id={id} action={formAction} className={className} aria-busy={pending} noValidate onSubmit={confirmText || keepValues ? submit : undefined} onInput={changed} onChange={changed}>
      {/* While the action runs every field and button of the form is off (the buttons dim): the
          pending state, and no second click. `contents`: the fieldset adds no box of its own. */}
      <fieldset disabled={pending} className="contents">
        {/* For PendingButton: a form sent by hand (keepValues) is not seen by useFormStatus. */}
        <FormPending value={pending}>{children}</FormPending>
      </fieldset>
      {state?.status === "error" && state.confirm ? (
        // Asked for by the server: the agent's explicit yes to what the message describes.
        <label className="flex basis-full items-start gap-2 text-[13px] font-semibold text-ink">
          <input type="checkbox" name={state.confirm.name} className="mt-0.5" />
          <span>{state.confirm.label}</span>
        </label>
      ) : null}
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={`${state.status === "error" ? alertError : alertSuccess} basis-full`}>
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
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, alertSuccess } from "@/components/ui";
import type { ActionState } from "./action-state";

type Action = (previous: ActionState, formData: FormData) => Promise<ActionState>;

// One small form of the quote editor (a price, a date, a remove button). It shows the action's
// message next to it; on success the page data refreshes by itself (revalidatePath).
export function ActionForm({
  action,
  children,
  className,
  id,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form id={id} action={formAction} className={className} aria-busy={pending} noValidate>
      {children}
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

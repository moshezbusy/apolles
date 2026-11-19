"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect } from "react";
import { alertError, alertSuccess, btnSecondary, inputUnsized } from "@/components/ui";
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
  // After an add, the quote it went to stays chosen (also a quote just made by "New quote"), so the
  // next room goes to the same quote. React resets the row's form after the action: the select is
  // remounted (key) with that quote as its default, so the reset keeps it.
  const added = state?.status === "success" ? (state.quoteId ?? null) : null;
  // Every rate row of the page then offers that quote: the page URL gets ?quote= (as when the
  // agent came from the quote's "+ Add hotel").
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (!added || params.get("quote") === added) return;
    const next = new URLSearchParams(params.toString());
    next.set("quote", added);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [added, params, pathname, router]);
  const list = added && !quotes.some((q) => q.id === added) ? [{ id: added, label: "The quote you just started" }, ...quotes] : quotes;
  const chosen = added ?? (defaultQuoteId && quotes.some((q) => q.id === defaultQuoteId) ? defaultQuoteId : "new");
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <select key={chosen} form={formId} name="quoteId" defaultValue={chosen} aria-label="Quote" className={`${inputUnsized} text-base sm:text-xs`}>
        <option value="new">New quote</option>
        {list.map((q) => (
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

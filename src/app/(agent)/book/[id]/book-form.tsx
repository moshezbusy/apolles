"use client";

import { useActionState } from "react";
import { alertError, btnPrimary, link } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import type { BookFormState } from "../form-state";

type Action = (previous: BookFormState, formData: FormData) => Promise<BookFormState>;

// Screen 11's one terms box (GR2, GR3) and its one button. The total sent is only compared on
// the server with the price it checked; it is never used as the price.
export function BookForm({
  action,
  bookingId,
  expectedTotal,
  terms,
  canPay,
  quoteCheck,
}: {
  action: Action;
  bookingId: string;
  expectedTotal: number;
  terms: { agentTerms: string; supplierTerms: string | null };
  canPay: boolean;
  // A booking from a quote whose price or terms are worse than what the client was quoted: the
  // agent ticks that they saw it ("From quote" box). The server checks the tick again.
  quoteCheck?: boolean;
}) {
  const [state, formAction, pending] = useActionState<BookFormState, FormData>(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state ? (
        <p role="alert" className={alertError}>
          {state.message}
        </p>
      ) : null}
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="expectedTotal" value={expectedTotal} />
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" name="acceptedTerms" required className="mt-0.5" />
        <span>
          I accept the{" "}
          <a href={terms.agentTerms} target="_blank" rel="noreferrer" className={link}>
            Apolles terms and conditions
          </a>{" "}
          and the{" "}
          {terms.supplierTerms ? (
            <a href={terms.supplierTerms} target="_blank" rel="noreferrer noopener" className={link}>
              Supplier Terms &amp; Conditions
            </a>
          ) : (
            <span className="font-semibold">Supplier Terms &amp; Conditions</span>
          )}
          , including the rate&apos;s cancellation policy.
        </span>
      </label>
      {quoteCheck ? (
        <label className="flex items-start gap-2 text-[13px] font-semibold text-ink">
          <input type="checkbox" name="quoteChecked" required className="mt-0.5" />
          <span>I checked the new price and terms</span>
        </label>
      ) : null}
      <button type="submit" disabled={pending || !canPay} className={btnPrimary}>
        {pending ? "Booking…" : `Book and pay ${formatUsd(expectedTotal)} from balance`}
      </button>
      <p className="text-center text-xs text-muted">The voucher is issued as soon as the hotel confirms.</p>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { alertError, alertInfo, alertSuccess, btnDanger, btnPrimary, btnSecondary, card, hint, input, label } from "@/components/ui";
import { formatUsd } from "@/lib/money";
import {
  cancelForAgentAction,
  checkWithSupplierAction,
  markResolvedAction,
  recordRefundAction,
  releaseHoldAction,
} from "./actions";
import type { BookingActionState } from "./form-state";

type Action = (previous: BookingActionState, formData: FormData) => Promise<BookingActionState>;

function Message({ state }: { state: BookingActionState }) {
  if (!state) return null;
  const style = state.status === "success" ? alertSuccess : state.status === "info" ? alertInfo : alertError;
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={style}>
      {state.message}
    </p>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={`${card} bg-white p-5`}>
      <h2 className="mb-3 text-base font-bold text-ink">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function NoteField({ name = "note", text }: { name?: string; text: string }) {
  return (
    <label className={label}>
      {text}
      <textarea name={name} rows={3} minLength={3} maxLength={500} required className={input} />
    </label>
  );
}

// "Check with the supplier now": no money moves, one click.
export function CheckNowForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(checkWithSupplierAction, null);
  return (
    <Panel title="Check with the supplier">
      <p className={hint}>Runs the booking&apos;s supplier check now instead of waiting for the next one.</p>
      <Message state={state} />
      <form action={formAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button type="submit" disabled={pending} className={btnSecondary}>
          {pending ? "Queuing…" : "Check with the supplier now"}
        </button>
      </form>
    </Panel>
  );
}

// "Mark resolved": clears "Needs attention"; the note is kept in the history.
export function ResolveForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(markResolvedAction, null);
  return (
    <Panel title="Mark resolved">
      <Message state={state} />
      {state?.status === "success" ? null : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="bookingId" value={bookingId} />
          <NoteField text="What you checked and did (kept in the history)" />
          <div>
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Mark resolved"}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// Step 1 shows the button; step 2 says exactly what will happen and posts. Money actions only.
function TwoStep({
  title,
  intro,
  startLabel,
  confirmText,
  confirmLabel,
  pendingLabel,
  action,
  hidden,
  children,
  danger = false,
}: {
  title: string;
  intro: string;
  startLabel: string;
  confirmText: (values: FormData) => string | null;
  confirmLabel: string;
  pendingLabel: string;
  action: Action;
  hidden: Record<string, string>;
  children?: React.ReactNode;
  danger?: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<BookingActionState, FormData>(async (previous, formData) => {
    const result = await action(previous, formData);
    setConfirming(null);
    return result;
  }, null);
  if (state?.status === "success") {
    return (
      <Panel title={title}>
        <Message state={state} />
      </Panel>
    );
  }
  return (
    <Panel title={title}>
      <p className={hint}>{intro}</p>
      <Message state={state} />
      <form
        action={formAction}
        onSubmit={(event) => {
          if (confirming !== null) return; // step 2: post
          event.preventDefault();
          const text = confirmText(new FormData(event.currentTarget));
          if (text !== null) setConfirming(text);
        }}
        className="flex flex-col gap-3"
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {/* Hidden, not disabled, on step 2: the values typed are still posted, and cannot change
            after the admin read the confirmation. */}
        <div className={confirming === null ? "flex flex-col gap-3" : "hidden"}>{children}</div>
        {confirming === null ? (
          <div>
            <button type="submit" className={danger ? btnDanger : btnPrimary}>
              {startLabel}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p role="status" className={alertInfo}>
              {confirming}
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={pending} className={danger ? btnDanger : btnPrimary}>
                {pending ? pendingLabel : confirmLabel}
              </button>
              <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={btnSecondary}>
                Go back
              </button>
            </div>
          </div>
        )}
      </form>
    </Panel>
  );
}

export function CancelForAgentForm({ bookingId, reference, chargeMinor, refundMinor }: { bookingId: string; reference: string; chargeMinor: number; refundMinor: number }) {
  return (
    <TwoStep
      title="Cancel for the agent"
      intro={`Cancels every room at the supplier, as the agent would, with today's charge. Charge ${formatUsd(chargeMinor)}, refund ${formatUsd(refundMinor)}. The agent is emailed that Apolles support cancelled it.`}
      startLabel="Cancel for the agent"
      confirmText={() => `Cancel booking ${reference} for the agent? The charge is ${formatUsd(chargeMinor)} and ${formatUsd(refundMinor)} goes back to the agency's balance once the supplier confirms.`}
      confirmLabel="Confirm cancellation"
      pendingLabel="Cancelling…"
      action={cancelForAgentAction}
      hidden={{ bookingId, expectedChargeMinor: String(chargeMinor) }}
      danger
    />
  );
}

// The amount must be a USD amount from 0.01 up to what was charged (the server checks again).
function centsOf(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function RefundForm({ bookingId, paidMinor }: { bookingId: string; paidMinor: number }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <TwoStep
      title="Record refund"
      intro={`The hotel or the supplier cancelled this booking. Record what the supplier gives back: the full ${formatUsd(paidMinor)} by default, or less. It is added to the agency's balance once, and the agent is emailed.`}
      startLabel="Review refund"
      confirmText={(values) => {
        const cents = centsOf(String(values.get("amount") ?? ""));
        if (cents === null || cents > paidMinor) {
          setProblem(`Enter an amount from USD 0.01 to ${formatUsd(paidMinor)}, at most 2 decimals.`);
          return null;
        }
        setProblem(null);
        return `Record a refund of ${formatUsd(cents)} of the ${formatUsd(paidMinor)} charged? It is added to the agency's balance and cannot be recorded twice.`;
      }}
      confirmLabel="Record refund"
      pendingLabel="Recording…"
      action={recordRefundAction}
      hidden={{ bookingId }}
    >
      {problem ? (
        <p role="alert" className={alertError}>
          {problem}
        </p>
      ) : null}
      <label className={label}>
        Refund (USD)
        <input name="amount" inputMode="decimal" maxLength={20} defaultValue={(paidMinor / 100).toFixed(2)} required className={`${input} max-w-[200px]`} />
      </label>
    </TwoStep>
  );
}

export function ReleaseHoldForm({ bookingId, heldMinor }: { bookingId: string; heldMinor: number }) {
  return (
    <TwoStep
      title="Release the hold and mark failed"
      intro={`Only when you checked with the supplier that this booking is not booked there. ${formatUsd(heldMinor)} held goes back to the agency's balance, the booking is marked not confirmed, and the agent is emailed.`}
      startLabel="Release the hold"
      confirmText={(values) => (String(values.get("note") ?? "").trim().length >= 3 ? `Release ${formatUsd(heldMinor)} to the agency and mark the booking not confirmed? Do this only if the supplier does not have the booking.` : null)}
      confirmLabel="Release and mark failed"
      pendingLabel="Releasing…"
      action={releaseHoldAction}
      hidden={{ bookingId }}
      danger
    >
      <NoteField text="How you checked that the supplier does not have it (kept in the history)" />
    </TwoStep>
  );
}

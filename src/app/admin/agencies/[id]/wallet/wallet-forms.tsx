"use client";

import { useActionState, useId, useState } from "react";
import { formatUsd, parseUsdToCents } from "@/lib/money";
import type { WalletFormState } from "./form-state";

type Action = (previous: WalletFormState, formData: FormData) => Promise<WalletFormState>;

type Field = {
  name: string;
  label: string;
  hint?: string; // shown under the input and read with it (aria-describedby)
  type?: "text" | "date";
  maxLength: number;
  placeholder?: string;
  inputMode?: "decimal";
};

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600";

function Message({ state }: { state: WalletFormState }) {
  if (!state) return null;
  const style =
    state.status === "success"
      ? "border-green-200 bg-green-50 text-green-800"
      : state.status === "info"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";
  return (
    <p role={state.status === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${style}`}>
      {state.message}
    </p>
  );
}

// Step 1: the admin fills in the fields and clicks Review (nothing is sent).
// Step 2: the amount is shown in USD and the admin confirms; only then is the form posted.
// The server action checks everything again, so this check is only a convenience.
function TwoStepForm({
  title,
  fields,
  hidden,
  allowNegative,
  confirmText,
  confirmLabel,
  action,
}: {
  title: string;
  fields: Field[];
  hidden: Record<string, string>;
  allowNegative: boolean;
  confirmText: (amountCents: number, values: Record<string, string>) => string;
  confirmLabel: string;
  action: Action;
}) {
  const formId = useId();
  const empty = Object.fromEntries(fields.map((f) => [f.name, ""]));
  const [values, setValues] = useState<Record<string, string>>(empty);
  const [reviewCents, setReviewCents] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<WalletFormState, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      setReviewCents(null);
      if (result?.status !== "error") setValues(empty);
      return result;
    },
    null,
  );

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseUsdToCents(values.amount ?? "", { allowNegative });
    if (cents === null) {
      setLocalError(
        allowNegative
          ? "Enter a non-zero amount in USD, e.g. 12.50 or -12.50 (at most 2 decimals)."
          : "Enter the amount in USD, e.g. 1,000.00 (at most 2 decimals).",
      );
      return;
    }
    const missing = fields.find((f) => (values[f.name] ?? "").trim() === "");
    if (missing) {
      setLocalError(`Fill in “${missing.label}”.`);
      return;
    }
    setLocalError(null);
    setReviewCents(cents);
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mb-4 flex flex-col gap-2">
        {localError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {localError}
          </p>
        ) : (
          <Message state={state} />
        )}
      </div>

      {reviewCents === null ? (
        <form onSubmit={review} className="flex flex-col gap-4" noValidate>
          {fields.map((field) => {
            const hintId = field.hint ? `${formId}-${field.name}-hint` : undefined;
            return (
              <div key={field.name} className="flex flex-col gap-1">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  {field.label}
                  <input
                    type={field.type ?? "text"}
                    name={field.name}
                    value={values[field.name] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    inputMode={field.inputMode}
                    autoComplete="off"
                    aria-describedby={hintId}
                    required
                    className={inputClass}
                  />
                </label>
                {field.hint ? (
                  <p id={hintId} className="text-sm text-gray-600">
                    {field.hint}
                  </p>
                ) : null}
              </div>
            );
          })}
          <button
            type="submit"
            className="self-start rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
          >
            Review
          </button>
        </form>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {fields.map((field) => (
            <input key={field.name} type="hidden" name={field.name} value={values[field.name] ?? ""} />
          ))}
          <p className="text-sm font-medium text-gray-900">{confirmText(reviewCents, values)}</p>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : confirmLabel}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setReviewCents(null)}
              className="text-sm text-blue-700 hover:underline disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type FormProps = { agencyId: string; agencyName: string; action: Action };

export function TopupForm({ agencyId, agencyName, action }: FormProps) {
  return (
    <TwoStepForm
      title="Bank top-up"
      fields={[
        { name: "amount", label: "Amount (USD)", maxLength: 20, placeholder: "1,000.00", inputMode: "decimal" },
        {
          name: "bankTransferRef",
          label: "Bank's transfer reference (from the bank statement)",
          hint: "Not the agency reference (APL-…).",
          maxLength: 100,
        },
        { name: "receivedOn", label: "Received on", type: "date", maxLength: 10 },
      ]}
      hidden={{ agencyId }}
      allowNegative={false}
      confirmText={(cents, v) =>
        `Confirm top-up of ${formatUsd(cents)} to ${agencyName}? Bank transfer ${v.bankTransferRef ?? ""}, received ${v.receivedOn ?? ""}.`
      }
      confirmLabel="Confirm top-up"
      action={action}
    />
  );
}

export function PayoutForm({ agencyId, agencyName, idempotencyKey, action }: FormProps & { idempotencyKey: string }) {
  return (
    <TwoStepForm
      title="Payout"
      fields={[
        { name: "amount", label: "Amount (USD)", maxLength: 20, placeholder: "250.00", inputMode: "decimal" },
        { name: "note", label: "Note", maxLength: 500 },
      ]}
      hidden={{ agencyId, idempotencyKey }}
      allowNegative={false}
      confirmText={(cents) => `Confirm payout of ${formatUsd(cents)} from ${agencyName}?`}
      confirmLabel="Confirm payout"
      action={action}
    />
  );
}

export function AdjustmentForm({
  agencyId,
  agencyName,
  idempotencyKey,
  action,
}: FormProps & { idempotencyKey: string }) {
  return (
    <TwoStepForm
      title="Adjustment"
      fields={[
        { name: "amount", label: "Amount (USD, negative to take money out)", maxLength: 21, placeholder: "-12.50" },
        { name: "reason", label: "Reason (at least 5 characters)", maxLength: 500 },
      ]}
      hidden={{ agencyId, idempotencyKey }}
      allowNegative
      confirmText={(cents) => `Confirm adjustment of ${formatUsd(cents)} to ${agencyName}?`}
      confirmLabel="Confirm adjustment"
      action={action}
    />
  );
}

"use client";

import Link from "next/link";
import { useActionState } from "react";
import { alertError, alertSuccess, btnPrimary, btnSecondary, input, label } from "@/components/ui";
import type { ClientFormState } from "./form-state";

type Action = (previous: ClientFormState, formData: FormData) => Promise<ClientFormState>;

export type ClientValues = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  nationality: string;
  notes: string;
};

// Add or edit a client (mockup 18, "Add client"). After an error the typed values are shown again.
export function ClientForm({
  action,
  values,
  countries,
  clientId,
  cancelHref,
}: {
  action: Action;
  values: ClientValues;
  countries: { code: string; name: string }[];
  clientId?: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(action, null);
  const shown = state?.status === "error" && state.values ? { ...values, ...state.values } : values;
  const knownCountry = countries.some((country) => country.code === shown.nationality);

  return (
    <form key={JSON.stringify(shown)} action={formAction} className="flex flex-col gap-3.5" noValidate>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
      {state?.status === "error" && state.duplicate ? (
        <p className="-mt-1.5 text-[13px]">
          <Link href={`/clients?id=${encodeURIComponent(state.duplicate.id)}#client`} className="font-semibold text-brand hover:underline">
            Open {state.duplicate.name}
          </Link>
          <input type="hidden" name="confirmDuplicate" value="1" />
        </p>
      ) : null}
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className={label}>
          First name
          <input type="text" name="firstName" required maxLength={60} autoComplete="off" defaultValue={shown.firstName} className={input} />
        </label>
        <label className={label}>
          Last name
          <input type="text" name="lastName" required maxLength={60} autoComplete="off" defaultValue={shown.lastName} className={input} />
        </label>
      </div>
      <label className={label}>
        WhatsApp phone
        <input type="tel" name="phone" required maxLength={30} autoComplete="off" placeholder="+972 50 123 4567" defaultValue={shown.phone} className={input} />
      </label>
      <label className={label}>
        Email (optional)
        <input type="email" name="email" maxLength={254} autoComplete="off" defaultValue={shown.email} className={input} />
      </label>
      <label className={label}>
        Nationality
        <select name="nationality" required defaultValue={knownCountry ? shown.nationality : ""} className={input}>
          {knownCountry ? null : (
            <option value="" disabled>
              Choose a country
            </option>
          )}
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Notes
        <textarea name="notes" rows={3} maxLength={1000} defaultValue={shown.notes} className={input} />
      </label>
      <div className="flex justify-end gap-2.5">
        <Link href={cancelHref} className={btnSecondary}>
          Cancel
        </Link>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save client"}
        </button>
      </div>
    </form>
  );
}

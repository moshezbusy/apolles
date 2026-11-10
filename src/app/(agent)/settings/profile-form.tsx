"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnPrimary, input, label } from "@/components/ui";
import type { SettingsFormState } from "./form-state";

type Action = (previous: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export type ProfileValues = { name: string; email: string; phone: string; country: string };

export function ProfileForm({
  action,
  values,
  countries,
}: {
  action: Action;
  values: ProfileValues;
  countries: { code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Agency name
          <input type="text" name="name" required minLength={2} maxLength={100} defaultValue={values.name} className={input} />
        </label>
        <label className={label}>
          Business email
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="office@agency.com"
            defaultValue={values.email}
            className={input}
          />
        </label>
        <label className={label}>
          Phone
          <input
            type="tel"
            name="phone"
            required
            maxLength={30}
            autoComplete="tel"
            placeholder="+972 50 123 4567"
            defaultValue={values.phone}
            className={input}
          />
        </label>
        <label className={label}>
          Country
          <select name="country" required defaultValue={values.country} className={input}>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="submit" disabled={pending} className={`self-start ${btnPrimary}`}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnPrimary, hint, input, label } from "@/components/ui";
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
  // After an error, show what the agent typed (React resets the fields after each post).
  const shown = state?.status === "error" && state.values ? { ...values, ...state.values } : values;
  // The agency name and country are shown, never sent: only Apolles can change them (the
  // country decides which hotel rates the agency is offered). A stored code that is not in the
  // list is shown as it is.
  const countryName = countries.find((country) => country.code === values.country)?.name ?? values.country;
  const readOnly = `${input} cursor-not-allowed bg-[#f6f3ec] text-muted`;

  return (
    <form key={JSON.stringify(shown)} action={formAction} className="flex flex-col gap-4" noValidate>
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Agency name
          <input type="text" readOnly aria-describedby="profile-fixed" value={values.name} className={readOnly} />
        </label>
        <label className={label}>
          Country
          <input type="text" readOnly aria-describedby="profile-fixed" value={countryName} className={readOnly} />
        </label>
        <p id="profile-fixed" className={`-mt-2 sm:col-span-2 ${hint}`}>
          Contact Apolles to change the agency name or country.
        </p>
        <label className={label}>
          Business email
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="office@agency.com"
            defaultValue={shown.email}
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
            defaultValue={shown.phone}
            className={input}
          />
        </label>
      </div>

      <button type="submit" disabled={pending} className={`self-start ${btnPrimary}`}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { alertError, alertSuccess, btnSecondary, hint } from "@/components/ui";
import type { SettingsFormState } from "./form-state";

type Action = (previous: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;

export function LogoForm({ action, rule }: { action: Action; rule: string }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state ? (
        <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? alertError : alertSuccess}>
          {state.message}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5 text-xs font-semibold text-[#37413d]">
        Upload a logo
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg"
          required
          aria-describedby="logo-rule"
          className="text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-[#d9e1dc] file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-brand hover:file:bg-brand-soft"
        />
      </label>
      <p id="logo-rule" className={hint}>
        {rule}
      </p>
      <button type="submit" disabled={pending} className={`self-start ${btnSecondary}`}>
        {pending ? "Uploading…" : "Upload logo"}
      </button>
    </form>
  );
}
